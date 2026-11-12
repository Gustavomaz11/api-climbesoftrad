import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { StoredObjectEntity } from '../../database/entities/stored-object.entity'
import {
  FileValidationService,
  InvalidUploadedFile,
} from '../file-validation/file-validation.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { ExamAttachmentWriterService } from '../exam-attachments/exam-attachment-writer.service'
import type { UploadExamAttachmentDto } from '../exam-attachments/exam-attachment.dto'
import { UploadScopeService } from './upload-scope.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { R2MultipartStorage } from '../file-validation/r2-multipart-storage.service'
import { UploadLiveContextService } from './upload-live-context.service'

@Injectable()
export class UploadValidationWorker {
  constructor(
    private readonly database: DataSource,
    private readonly validation: FileValidationService,
    private readonly writer: ExamAttachmentWriterService,
    private readonly audit: OperationalAuditService,
    private readonly scope: UploadScopeService,
    private readonly storage: R2MultipartStorage,
    private readonly live: UploadLiveContextService,
  ) {}
  async retry(id: string, context: CompanyAccessContext) {
    const session = await this.scope.require(id, context)
    if (session.status === 'QUARANTINED')
      await this.database
        .getRepository(UploadSessionEntity)
        .update({ id, status: 'QUARANTINED' }, { status: 'RECEIVED', validationReason: null })
    return { status: 'QUEUED' }
  }
  async runBatch() {
    const sessions = await this.database
      .getRepository(UploadSessionEntity)
      .createQueryBuilder('u')
      .where(
        "u.status='RECEIVED' OR (u.status='VALIDATING' AND u.lease_until < now()) OR (u.status='APPROVED' AND u.kind='ATTACHMENT')",
      )
      .orderBy('u.created_at', 'ASC')
      .take(8)
      .getMany()
    // Bound simultaneous downloads/scans while allowing a study to advance as a batch.
    for (let offset = 0; offset < sessions.length; offset += 4) {
      await Promise.all(sessions.slice(offset, offset + 4).map(async session => {
        if (session.status === 'APPROVED') await this.publishAttachment(session)
        else await this.validate(session.id)
      }))
    }
    await this.expire()
  }
  async validate(id: string) {
    const [claimed] = await this.database.query<Array<{ id: string }>>(
      `UPDATE upload_sessions SET status='VALIDATING',lease_until=now()+interval '10 minutes'
      WHERE id=$1 AND (status='RECEIVED' OR (status='VALIDATING' AND lease_until<now())) RETURNING id`,
      [id],
    )
    if (!claimed) return
    const session = await this.database.getRepository(UploadSessionEntity).findOneByOrFail({ id })
    try {
      session.context = await this.live.resolve(session)
      this.scope.permission(session.kind, session.context)
      const metadata = await this.validation.stored(session)
      session.payload = { ...session.payload, metadata }
      session.status = 'APPROVED'
      session.validationReason = null
      session.leaseUntil = null
      await this.database.transaction(async (manager) => {
        await manager.save(session)
        await this.audit.record(
          session.context,
          {
            action: 'UPLOAD_VALIDATED',
            resourceType: 'upload',
            resourceId: id,
            unitId: session.unitId,
            metadata: { status: 'APPROVED' },
          },
          manager,
        )
      })
      if (session.kind === 'ATTACHMENT') await this.publishAttachment(session)
    } catch (error) {
      const rejected = error instanceof InvalidUploadedFile
      session.status = rejected ? 'REJECTED' : 'QUARANTINED'
      session.validationReason = rejected
        ? error.message
        : 'Validação ou publicação indisponível. Reprocessamento necessário.'
      session.leaseUntil = null
      await this.database.transaction(async (manager) => {
        await manager.save(session)
        await this.audit.record(
          session.context,
          {
            action: 'UPLOAD_VALIDATED',
            resourceType: 'upload',
            resourceId: id,
            unitId: session.unitId,
            metadata: { status: session.status },
          },
          manager,
        )
      })
    }
  }
  private async publishAttachment(session: UploadSessionEntity) {
    session.context = await this.live.resolve(session)
    this.scope.permission(session.kind, session.context)
    // Reconcile publication when the process stopped after linking the object.
    const [existing] = await this.database.query<Array<{ id: string }>>(
      'SELECT id FROM exam_attachments WHERE object_id=$1',
      [session.id],
    )
    if (existing) {
      await this.database
        .getRepository(UploadSessionEntity)
        .update(session.id, { status: 'PUBLISHED', resultId: existing.id })
      return
    }
    const object = await this.database.getRepository(StoredObjectEntity).save({
      id: session.id,
      companyId: session.companyId,
      examId: session.examId,
      storageKey: session.storageKey,
      originalName: session.name,
      contentType: session.contentType,
      sizeBytes: session.sizeBytes,
      sha256: session.sha256,
      status: 'REGISTERED',
      createdByUserId: session.context.userId,
    })
    const saved = await this.writer.publish(
      object,
      session.payload as unknown as UploadExamAttachmentDto,
      session.unitId,
      session.context,
    )
    await this.database
      .getRepository(UploadSessionEntity)
      .update(session.id, { status: 'PUBLISHED', resultId: saved.id })
  }
  private async expire() {
    const expired = await this.database
      .getRepository(UploadSessionEntity)
      .createQueryBuilder('u')
      .where("u.status='UPLOADING' AND u.expires_at < now()")
      .take(20)
      .getMany()
    for (const session of expired) {
      await this.database.transaction(async (manager) => {
        const locked = await manager
          .getRepository(UploadSessionEntity)
          .findOneOrFail({ where: { id: session.id }, lock: { mode: 'pessimistic_write' } })
        if (locked.status !== 'UPLOADING') return
        await this.storage.abort(locked.storageKey, locked.multipartId)
        await manager.getRepository(UploadSessionEntity).update(locked.id, { status: 'EXPIRED' })
      })
    }
  }
}
