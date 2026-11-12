import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { R2MultipartStorage } from '../file-validation/r2-multipart-storage.service'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { UploadScopeService } from './upload-scope.service'
import { assertCompleteParts } from './upload.policy'
@Injectable()
export class UploadLifecycleService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: UploadScopeService,
    private readonly storage: R2MultipartStorage,
    private readonly objects: R2ObjectStorage,
    private readonly audit: OperationalAuditService,
  ) {}
  async complete(id: string, context: CompanyAccessContext, sourceId?: string) {
    await this.scope.require(id, context, sourceId)
    await this.database.transaction(async (manager) => {
      const session = await manager
        .getRepository(UploadSessionEntity)
        .findOneOrFail({ where: { id }, lock: { mode: 'pessimistic_write' } })
      if (
        ['RECEIVED', 'VALIDATING', 'APPROVED', 'AWAITING_REVIEW', 'FORWARDED', 'QUARANTINED', 'REJECTED', 'PUBLISHED'].includes(
          session.status,
        )
      )
        return
      this.assertOpen(session)
      // A previous CompleteMultipartUpload may have succeeded before a DB/network failure.
      const existing = await this.objects.stat(session.storageKey)
      if (!existing) {
        const parts = assertCompleteParts(
          session.sizeBytes,
          await this.storage.parts(session.storageKey, session.multipartId),
        )
        await this.storage.complete(session.storageKey, session.multipartId, parts)
      }
      session.status = 'RECEIVED'
      await manager.save(session)
      await this.audit.record(
        context,
        {
          action: 'UPLOAD_COMPLETED',
          resourceType: 'upload',
          resourceId: id,
          unitId: session.unitId,
        },
        manager,
      )
    })
  }
  async cancel(id: string, context: CompanyAccessContext, sourceId?: string) {
    await this.scope.require(id, context, sourceId)
    return this.database.transaction(async (manager) => {
      const session = await manager
        .getRepository(UploadSessionEntity)
        .findOneOrFail({ where: { id }, lock: { mode: 'pessimistic_write' } })
      if (session.status === 'CANCELLED') return { status: session.status }
      if (session.status !== 'UPLOADING')
        throw new ConflictException(
          'O arquivo já foi recebido; preserve a evidência e confira a validação.',
        )
      await this.storage.abort(session.storageKey, session.multipartId)
      session.status = 'CANCELLED'
      await manager.save(session)
      await this.audit.record(
        context,
        {
          action: 'UPLOAD_CANCELLED',
          resourceType: 'upload',
          resourceId: id,
          unitId: session.unitId,
        },
        manager,
      )
      return { status: session.status }
    })
  }
  private assertOpen(session: UploadSessionEntity) {
    if (session.status !== 'UPLOADING' || session.expiresAt.getTime() <= Date.now())
      throw new ConflictException('Sessão encerrada ou expirada.')
  }
}
