import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, IsNull } from 'typeorm'
import { ExamAttachmentEntity } from '../../database/entities/exam-attachment.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { ExamAccessService } from '../exams/exam-access.service'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'

@Injectable()
export class ExamAttachmentReaderService {
  constructor(
    private readonly database: DataSource,
    private readonly access: ExamAccessService,
    private readonly objects: R2ObjectStorage,
    private readonly audit: OperationalAuditService,
  ) {}

  async list(examId: string, context: CompanyAccessContext) {
    await this.access.require(examId, context)
    const records = await this.database.getRepository(ExamAttachmentEntity).find({
      where: { examId, companyId: context.companyId },
      relations: { object: true, author: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    })
    return records.map((record) => ({
      id: record.id,
      category: record.category,
      version: record.version,
      replacesId: record.replacesId,
      current: !record.supersededAt,
      validationStatus: record.validationStatus,
      reason: record.reason,
      createdAt: record.createdAt,
      authorName: record.author.fullName,
      name: record.object.originalName,
      contentType: record.object.contentType,
      sizeBytes: record.object.sizeBytes,
      sha256: record.object.sha256,
    }))
  }

  async availability(examId: string, context: CompanyAccessContext) {
    await this.access.require(examId, context)
    if (!context.permissions.includes('attachments.view'))
      return { status: 'NOT_AUTHORIZED', count: 0 }
    const records = await this.database.getRepository(ExamAttachmentEntity).find({
      where: { examId, companyId: context.companyId, supersededAt: IsNull() },
      relations: { object: true },
    })
    if (!records.length) return { status: 'UNAVAILABLE', count: 0 }
    const states = await Promise.all(records.map((record) => this.check(record)))
    return {
      status: states.every((status) => status === 'AVAILABLE') ? 'AVAILABLE' : 'RECOVERY_REQUIRED',
      count: records.length,
    }
  }

  async open(examId: string, id: string, context: CompanyAccessContext) {
    const exam = await this.access.require(examId, context)
    const record = await this.database.getRepository(ExamAttachmentEntity).findOne({
      where: { id, examId, companyId: context.companyId },
      relations: { object: true },
    })
    if (!record) throw new NotFoundException('Anexo não encontrado.')
    const status = await this.check(record)
    if (status === 'UNAVAILABLE')
      throw new NotFoundException('Arquivo indisponível no armazenamento.')
    if (status !== 'AVAILABLE')
      throw new ConflictException('Arquivo requer conferência de integridade ou recuperação.')
    const expiresIn = 300
    const url = await this.audit.external(
      context,
      {
        action: 'EXAM_ATTACHMENT_ACCESSED',
        resourceType: 'exam',
        resourceId: examId,
        unitId: exam.unitId,
        metadata: { attachmentId: id, version: record.version, expiresIn },
      },
      () => this.objects.signedGetUrl(record.object.storageKey, expiresIn),
    )
    return {
      id,
      name: record.object.originalName,
      contentType: record.object.contentType,
      sizeBytes: record.object.sizeBytes,
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    }
  }

  private async check(record: ExamAttachmentEntity) {
    if (record.object.status !== 'STORED' || record.validationStatus !== 'APPROVED')
      return 'RECOVERY_REQUIRED'
    const stat = await this.objects.stat(record.object.storageKey)
    if (!stat) return 'UNAVAILABLE'
    return stat.sizeBytes === record.object.sizeBytes && stat.sha256 === record.object.sha256
      ? 'AVAILABLE'
      : 'RECOVERY_REQUIRED'
  }
}
