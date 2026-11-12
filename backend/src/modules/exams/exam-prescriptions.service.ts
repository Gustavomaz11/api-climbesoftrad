import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'node:crypto'
import type { Repository } from 'typeorm'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import type { ExamEntity } from '../../database/entities/exam.entity'
import { PhysicianEntity } from '../../database/entities/physician.entity'
import { registeredCrmForState } from '../physicians/physician-registry.policy'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { DocumentPresentation } from '../companies/company-presentation'
import { CompanyPresentationService } from '../companies/company-presentation.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { SaveExamPrescriptionDto } from './dto/save-exam-prescription.dto'
import { ExamAccessService } from './exam-access.service'
import { R2ObjectStorage } from './r2-object-storage.service'
import { assertUploadedFileSignature } from './uploaded-file-security'
import { WorkflowStoreService } from '../exam-workflow/workflow-store.service'
import { PrescriptionProtocolsService } from '../contrast-protocols/prescription-protocols.service'
import type { PrescriptionProtocolSnapshot } from '../../database/entities/prescription-protocol-selection.entity'

export interface PrescriptionNode {
  type?: unknown
  attrs?: Record<string, unknown>
  content?: PrescriptionNode[]
  [key: string]: unknown
}

export interface PrescriptionSignature {
  userId: string
  name: string
  specialty: string
  crm: string
  signedAt: string
}

interface StoredPrescription {
  version: 1
  examId: string
  content: PrescriptionNode
  updatedAt: string
  updatedByUserId: string
  signature: PrescriptionSignature | null
  presentation?: DocumentPresentation
  protocolSource?: PrescriptionProtocolSnapshot & { selectionId: string }
}

const initialContent: PrescriptionNode = { type: 'doc', content: [{ type: 'paragraph' }] }
const prescriptionKey = (id: string) => `prescriptions/${id}/prescription.json`
const blankPresentation: DocumentPresentation = {
  headerText: '',
  footerText: '',
  signatureText: '',
}
const imageExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

@Injectable()
export class ExamPrescriptionsService {
  constructor(
    @InjectRepository(AuthUserEntity) private readonly users: Repository<AuthUserEntity>,
    @InjectRepository(PhysicianEntity) private readonly physicians: Repository<PhysicianEntity>,
    private readonly objects: R2ObjectStorage,
    private readonly access: ExamAccessService,
    private readonly audit: OperationalAuditService,
    private readonly presentation: CompanyPresentationService,
    private readonly protocols: PrescriptionProtocolsService,
    private readonly workflow: WorkflowStoreService,
  ) {}

  async get(examId: string, context: CompanyAccessContext) {
    const exam = await this.access.require(examId, context)
    const body = await this.objects.readText(prescriptionKey(examId))
    const current = (
      await this.presentation.current(context.companyId, exam.unitId, context.userId)
    ).effective
    if (!body)
      return {
        exam: this.summary(exam),
        content: initialContent,
        updatedAt: null,
        signature: null,
        presentation: current,
      }
    const prescription = JSON.parse(body) as StoredPrescription
    return {
      exam: this.summary(exam),
      content: await this.hydrate(examId, prescription.content),
      updatedAt: prescription.updatedAt,
      signature: prescription.signature,
      presentation: prescription.signature
        ? (prescription.presentation ?? blankPresentation)
        : current,
      protocolSource: prescription.protocolSource ?? null,
    }
  }

  async save(examId: string, dto: SaveExamPrescriptionDto, context: CompanyAccessContext) {
    return this.workflow.writable(examId, context, (exam) =>
      this.write(exam, dto.content, context, null, undefined, undefined, dto.protocolSelectionId),
    )
  }

  async sign(examId: string, dto: SaveExamPrescriptionDto, context: CompanyAccessContext) {
    return this.workflow.writable(examId, context, async (exam) => {
      const user = await this.users.findOneBy({ id: context.userId, status: 'ACTIVE' })
      if (!user) throw new NotFoundException('Usuário não encontrado.')
      const physician = await this.physicians.findOne({
        where: { userId: user.id },
        relations: { specialty: true },
      })
      if (!physician || user.role !== 'DOCTOR')
        throw new ForbiddenException('Somente médicos cadastrados podem assinar prescrições.')
      const [location] = physician.registryProfile
        ? await this.physicians.query<Array<{uf:string | null}>>('SELECT uf FROM hospital_units WHERE id=$1',[exam.unitId]) : []
      const signature: PrescriptionSignature = {
        userId: user.id,
        name: physician.name,
        specialty: physician.specialty.name,
        crm: registeredCrmForState(physician.registryProfile, location?.uf ?? null, physician.crm),
        signedAt: new Date().toISOString(),
      }
      const presentation = (
        await this.presentation.current(context.companyId, exam.unitId, user.id)
      ).effective
      return this.write(
        exam,
        dto.content,
        context,
        signature,
        presentation,
        signature.signedAt,
        dto.protocolSelectionId,
      )
    })
  }

  async uploadImage(examId: string, file: Express.Multer.File, context: CompanyAccessContext) {
    return this.workflow.writable(examId, context, async (exam) => {
      const extension = imageExtensions[file.mimetype]
      if (!extension) throw new BadRequestException('Formato de imagem não permitido.')
      assertUploadedFileSignature(file)
      const key = `prescriptions/${examId}/images/${randomUUID()}.${extension}`
      await this.audit.external(
        context,
        {
          action: 'PRESCRIPTION_IMAGE_UPLOADED',
          resourceType: 'exam',
          resourceId: examId,
          unitId: exam.unitId,
          metadata: {
            storageKey: key,
            sizeBytes: file.size,
            payloadHash: createHash('sha256').update(file.buffer).digest('hex'),
          },
        },
        () =>
          this.objects.put(key, {
            body: file.buffer,
            contentType: file.mimetype,
            cacheControl: 'private, max-age=3600',
          }),
      )
      return { storageKey: key, url: await this.objects.signedGetUrl(key) }
    })
  }

  private async write(
    exam: ExamEntity,
    content: Record<string, unknown>,
    context: CompanyAccessContext,
    signature: PrescriptionSignature | null,
    presentation?: DocumentPresentation,
    timestamp = new Date().toISOString(),
    protocolSelectionId?: string,
  ) {
    const serialized = JSON.stringify(content)
    if (Buffer.byteLength(serialized, 'utf8') > 2_000_000)
      throw new PayloadTooLargeException('Prescrição excede o limite permitido.')
    const prescription: StoredPrescription = {
      version: 1,
      examId: exam.id,
      content,
      signature,
      presentation,
      updatedAt: timestamp,
      updatedByUserId: context.userId,
      protocolSource: protocolSelectionId
        ? await this.protocols.snapshot(protocolSelectionId, exam.id, context)
        : undefined,
    }
    await this.audit.external(
      context,
      {
        action: signature ? 'PRESCRIPTION_SIGNED' : 'PRESCRIPTION_SAVED',
        resourceType: 'exam',
        resourceId: exam.id,
        unitId: exam.unitId,
        metadata: {
          storageKey: prescriptionKey(exam.id),
          payloadHash: createHash('sha256').update(JSON.stringify(prescription)).digest('hex'),
          contentHash: createHash('sha256').update(serialized).digest('hex'),
        },
      },
      () =>
        this.objects.put(prescriptionKey(exam.id), {
          body: JSON.stringify(prescription),
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'no-store',
        }),
    )
    return { updatedAt: timestamp, signature, presentation }
  }

  private summary(exam: ExamEntity) {
    return {
      id: exam.id,
      companyId: exam.companyId,
      unitId: exam.unitId,
      unit: exam.unit.name,
      patientName: exam.patientName,
      studyDescription: exam.studyDescription,
      performedAt: exam.performedAt,
      modality: exam.modality,
      workflowState: exam.workflowState,
      archivedAt: exam.archivedAt,
    }
  }

  private async hydrate(examId: string, node: PrescriptionNode): Promise<PrescriptionNode> {
    const hydrated = { ...node }
    const key = node.attrs?.storageKey
    if (
      node.type === 'image' &&
      typeof key === 'string' &&
      key.startsWith(`prescriptions/${examId}/images/`)
    ) {
      hydrated.attrs = { ...node.attrs, src: await this.objects.signedGetUrl(key) }
    }
    if (node.content)
      hydrated.content = await Promise.all(node.content.map((child) => this.hydrate(examId, child)))
    return hydrated
  }
}
