import { BadRequestException, ConflictException, Injectable, PayloadTooLargeException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import type { ExamEntity } from '../../database/entities/exam.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { CompanyPresentationService } from '../companies/company-presentation.service'
import type { SaveExamReportDto } from './dto/save-exam-report.dto'
import { ExamAccessService } from './exam-access.service'
import { R2ExamReportStorage } from './r2-exam-report-storage.service'
import { assertUploadedFileSignature } from './uploaded-file-security'
import { WorkflowStoreService } from '../exam-workflow/workflow-store.service'

export interface ReportNode {
  type?: unknown
  attrs?: Record<string, unknown>
  content?: ReportNode[]
  [key: string]: unknown
}

interface StoredReport {
  version: 1
  examId: string
  content: ReportNode
  updatedAt: string
  updatedByUserId: string
}

const initialContent: ReportNode = { type: 'doc', content: [{ type: 'paragraph' }] }
const imageExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

@Injectable()
export class ExamReportsService {
  constructor(
    private readonly storage: R2ExamReportStorage,
    private readonly access: ExamAccessService,
    private readonly audit: OperationalAuditService,
    private readonly presentation: CompanyPresentationService,
    private readonly workflow: WorkflowStoreService,
  ) {}

  async get(examId: string, context: CompanyAccessContext) {
    const exam = await this.access.require(examId, context)
    const presentation = (
      await this.presentation.current(context.companyId, exam.unitId, context.userId)
    ).effective
    const body = await this.storage.read(examId)
    if (!body)
      return { exam: this.summary(exam), content: initialContent, updatedAt: null, presentation }
    const report = JSON.parse(body) as StoredReport
    return {
      exam: this.summary(exam),
      content: await this.hydrate(examId, report.content),
      updatedAt: report.updatedAt,
      presentation,
    }
  }

  async save(examId: string, dto: SaveExamReportDto, context: CompanyAccessContext) {
    return this.workflow.writable(examId, context, async (exam, manager) => {
      const [completed] = await manager.query<unknown[]>('SELECT id FROM exam_report_completions WHERE exam_id=$1', [examId])
      if (completed) throw new ConflictException('Laudo finalizado: edição indisponível.')
      const serialized = JSON.stringify(dto.content)
      if (Buffer.byteLength(serialized, 'utf8') > 2_000_000)
        throw new PayloadTooLargeException('Laudo excede o limite permitido.')
      const updatedAt = new Date().toISOString()
      const report: StoredReport = {
        version: 1,
        examId,
        content: dto.content,
        updatedAt,
        updatedByUserId: context.userId,
      }
      await this.audit.external(
        context,
        {
          action: 'REPORT_SAVED',
          resourceType: 'exam',
          resourceId: examId,
          unitId: exam.unitId,
          metadata: {
            storageKey: `reports/${examId}/report.json`,
            payloadHash: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
            contentHash: createHash('sha256').update(serialized).digest('hex'),
          },
        },
        () => this.storage.write(examId, JSON.stringify(report)),
      )
      return { updatedAt, contentHash: createHash('sha256').update(serialized).digest('hex') }
    })
  }

  async uploadImage(examId: string, file: Express.Multer.File, context: CompanyAccessContext) {
    return this.workflow.writable(examId, context, async (exam, manager) => {
      const [completed] = await manager.query<unknown[]>('SELECT id FROM exam_report_completions WHERE exam_id=$1', [examId])
      if (completed) throw new ConflictException('Laudo finalizado: edição indisponível.')
      const extension = imageExtensions[file.mimetype]
      if (!extension) throw new BadRequestException('Formato de imagem não permitido.')
      assertUploadedFileSignature(file)
      const key = `reports/${examId}/images/${randomUUID()}.${extension}`
      await this.audit.external(
        context,
        {
          action: 'REPORT_IMAGE_UPLOADED',
          resourceType: 'exam',
          resourceId: examId,
          unitId: exam.unitId,
          metadata: {
            storageKey: key,
            sizeBytes: file.size,
            payloadHash: createHash('sha256').update(file.buffer).digest('hex'),
          },
        },
        () => this.storage.uploadImage(key, file.buffer, file.mimetype),
      )
      return { storageKey: key, url: await this.storage.signedImageUrl(key) }
    })
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
      workflowVersion: exam.workflowVersion,
      archivedAt: exam.archivedAt,
    }
  }

  private async hydrate(examId: string, node: ReportNode): Promise<ReportNode> {
    const hydrated = { ...node }
    const key = node.attrs?.storageKey
    if (
      node.type === 'image' &&
      typeof key === 'string' &&
      key.startsWith(`reports/${examId}/images/`)
    ) {
      hydrated.attrs = { ...node.attrs, src: await this.storage.signedImageUrl(key) }
    }
    if (node.content)
      hydrated.content = await Promise.all(node.content.map((child) => this.hydrate(examId, child)))
    return hydrated
  }
}
