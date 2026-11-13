import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { DataSource, In } from 'typeorm'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { DicomSourceEntity } from '../../database/entities/dicom-source.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { ExamAccessService } from '../exams/exam-access.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { R2MultipartStorage } from '../file-validation/r2-multipart-storage.service'
import { UploadLifecycleService } from './upload-lifecycle.service'
import { CreateUploadDto } from './upload.dto'
import { UploadScopeService } from './upload-scope.service'
import { assertUploadInput, expectedPartSize, uploadPartSize } from './upload.policy'
import { assertExamOperationallyWritable } from '../exam-workflow/workflow-mutation-policy'
import { receiptLock, validateHospitalDelivery } from './hospital-delivery.policy'

@Injectable()
export class UploadSessionsService {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly companies: CompanyScopeService,
    private readonly access: ExamAccessService,
    private readonly scope: UploadScopeService,
    private readonly storage: R2MultipartStorage,
    private readonly lifecycle: UploadLifecycleService,
    private readonly audit: OperationalAuditService,
  ) {}
  limits() {
    return {
      documentMaxBytes: this.config.getOrThrow<number>('UPLOAD_DOCUMENT_MAX_BYTES'),
      dicomMaxBytes: this.config.getOrThrow<number>('UPLOAD_DICOM_MAX_BYTES'),
      partSize: uploadPartSize,
    }
  }
  async list(context: CompanyAccessContext, examId?: string) {
    if (examId) await this.access.require(examId, context)
    const kinds: Array<'ATTACHMENT' | 'DICOM'> = []
    if (context.permissions.includes('attachments.upload')) kinds.push('ATTACHMENT')
    if (context.permissions.includes('dicom.import')) kinds.push('DICOM')
    if (!kinds.length) return []
    const records = await this.database.getRepository(UploadSessionEntity).find({
      where: {
        companyId: context.companyId,
        kind: In(kinds),
        ...(examId ? { examId } : {}),
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      order: { createdAt: 'DESC' },
      take: 100,
    })
    return records.filter(record => this.scope.permitsPortal(record.kind, record.payload.hospitalIntake === true, context)).map((record) => this.present(record, []))
  }
  async create(dto: CreateUploadDto, context: CompanyAccessContext) {
    if (dto.sourceId && context.integrationSourceId !== dto.sourceId)
      throw new BadRequestException('Origem exclusiva da credencial do agente.')
    this.scope.permission(dto.kind, context)
    const hospitalIntake = dto.kind === 'DICOM' && (dto.hospitalIntake === true ||
      (context.permissions.includes('hospital.intake.submit') && !context.permissions.includes('exams.create')))
    this.scope.portal(dto.kind, hospitalIntake, context)
    const unit = await this.companies.requireUnit(dto.unitId, context)
    if (!unit.active) throw new BadRequestException('Unidade inativa.')
    assertUploadInput(
      dto,
      this.config.getOrThrow<number>('UPLOAD_DOCUMENT_MAX_BYTES'),
      this.config.getOrThrow<number>('UPLOAD_DICOM_MAX_BYTES'),
    )
    if (dto.examId) {
      const exam = await this.access.require(dto.examId, context)
      if (exam.unitId !== dto.unitId) throw new BadRequestException('Exame de outra unidade.')
      assertExamOperationallyWritable(exam)
    }
    if (dto.kind === 'ATTACHMENT' && (!dto.examId || !dto.category))
      throw new BadRequestException('Selecione exame e categoria.')
    if (dto.replacesId && (!dto.expectedVersion || !dto.reason?.trim()))
      throw new BadRequestException('Substituição exige versão e justificativa.')
    if (dto.kind === 'DICOM' && (dto.examId || dto.category || dto.replacesId))
      throw new BadRequestException('A ingestão associa o estudo pelos metadados.')
    if (
      dto.sourceId &&
      !(await this.database.getRepository(DicomSourceEntity).existsBy({
        id: dto.sourceId,
        companyId: context.companyId,
        unitId: dto.unitId,
        active: true,
      }))
    )
      throw new BadRequestException('Origem indisponível.')
    const id = randomUUID(),
      storageKey = `ingestion/${context.companyId}/${dto.unitId}/${id}`
    const multipartId = await this.storage.begin(storageKey, dto.contentType, dto.sha256)
    try {
      const saved = await this.database.transaction(async (manager) => {
        if (hospitalIntake) await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [receiptLock(context.companyId, dto.unitId)])
        await validateHospitalDelivery(manager, dto, context, hospitalIntake)
        const session = await manager.getRepository(UploadSessionEntity).save({
          id,
          companyId: context.companyId,
          unitId: dto.unitId,
          examId: dto.examId ?? null,
          sourceId: dto.sourceId ?? null,
          kind: dto.kind,
          name: dto.name,
          contentType: dto.contentType,
          sizeBytes: dto.sizeBytes,
          sha256: dto.sha256,
          storageKey,
          multipartId,
          status: 'UPLOADING',
          payload: {
            hospitalIntake,
            deliveryId: dto.deliveryId,
            deliveryFileId: dto.deliveryFileId,
            deliveryTotal: dto.deliveryTotal,
            category: dto.category,
            replacesId: dto.replacesId,
            expectedVersion: dto.expectedVersion,
            reason: dto.reason,
          },
          context,
          expiresAt: new Date(
            Date.now() + this.config.getOrThrow<number>('UPLOAD_SESSION_HOURS') * 3600000,
          ),
        })
        await this.audit.record(
          context,
          {
            action: 'UPLOAD_STARTED',
            resourceType: 'upload',
            resourceId: id,
            unitId: dto.unitId,
            metadata: { kind: dto.kind, sizeBytes: dto.sizeBytes },
          },
          manager,
        )
        return session
      })
      return this.present(saved, [])
    } catch (error) {
      await this.storage.abort(storageKey, multipartId)
      throw error
    }
  }
  async get(id: string, context: CompanyAccessContext, sourceId?: string) {
    const session = await this.scope.require(id, context, sourceId)
    const parts =
      session.status === 'UPLOADING'
        ? await this.storage.parts(session.storageKey, session.multipartId)
        : []
    return this.present(session, parts)
  }
  async sign(id: string, number: number, context: CompanyAccessContext, sourceId?: string) {
    const session = await this.scope.require(id, context, sourceId)
    this.assertOpen(session)
    const sizeBytes = expectedPartSize(session.sizeBytes, number)
    return {
      url: await this.storage.signPart(session.storageKey, session.multipartId, number),
      sizeBytes,
      expiresIn: 300,
      transport: this.config.get<string>('UPLOAD_BROWSER_TRANSPORT') ?? 'API',
    }
  }
  async complete(id: string, context: CompanyAccessContext, sourceId?: string) {
    await this.lifecycle.complete(id, context, sourceId)
    return this.get(id, context, sourceId)
  }
  cancel(id: string, context: CompanyAccessContext, sourceId?: string) {
    return this.lifecycle.cancel(id, context, sourceId)
  }
  private assertOpen(session: UploadSessionEntity) {
    if (session.status !== 'UPLOADING' || session.expiresAt.getTime() <= Date.now())
      throw new ConflictException('Sessão encerrada ou expirada.')
  }
  private present(
    session: UploadSessionEntity,
    parts: Array<{ number: number; size: number; etag: string }>,
  ) {
    return {
      id: session.id,
      kind: session.kind,
      name: session.name,
      status: session.status,
      sizeBytes: session.sizeBytes,
      sha256: session.sha256,
      partSize: uploadPartSize,
      parts,
      expiresAt: session.expiresAt,
      validationReason: session.validationReason,
      resultId: session.resultId,
      examId: session.examId,
      metadata: session.payload.metadata ?? null,
    }
  }
}
