import { Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { ExamAttachmentEntity } from '../../database/entities/exam-attachment.entity'
import { ExamEntity } from '../../database/entities/exam.entity'
import {
  FileValidationService,
  InvalidUploadedFile,
} from '../file-validation/file-validation.service'
import { ExamAccessService } from '../exams/exam-access.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
@Injectable()
export class AttachmentRevalidationService {
  constructor(
    private readonly database: DataSource,
    private readonly access: ExamAccessService,
    private readonly validation: FileValidationService,
    private readonly audit: OperationalAuditService,
  ) {}
  async validate(examId: string, id: string, context: CompanyAccessContext) {
    const exam = await this.access.require(examId, context)
    const attachment = await this.database
      .getRepository(ExamAttachmentEntity)
      .findOne({ where: { id, examId, companyId: context.companyId }, relations: { object: true } })
    if (!attachment) throw new NotFoundException('Anexo não encontrado.')
    let status: ExamAttachmentEntity['validationStatus'] = 'APPROVED',
      reason: string | null = null
    try {
      await this.validation.stored({ ...attachment.object, kind: 'ATTACHMENT' })
    } catch (error) {
      status = error instanceof InvalidUploadedFile ? 'REJECTED' : 'QUARANTINED'
      reason =
        error instanceof InvalidUploadedFile
          ? error.message
          : 'Varredura ou armazenamento indisponível.'
    }
    await this.database.transaction(async (manager) => {
      await manager
        .getRepository(ExamEntity)
        .findOneOrFail({
          where: { id: examId, companyId: context.companyId },
          lock: { mode: 'pessimistic_write' },
        })
      await manager.getRepository(ExamAttachmentEntity).update(id, { validationStatus: status })
      await this.audit.record(
        context,
        {
          action: 'UPLOAD_VALIDATED',
          resourceType: 'attachment',
          resourceId: id,
          unitId: exam.unitId,
          reason,
          metadata: { status, version: attachment.version },
        },
        manager,
      )
    })
    return { id, status, reason }
  }
}
