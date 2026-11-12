import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { DataSource, type EntityManager } from 'typeorm'
import { ExamAttachmentEntity } from '../../database/entities/exam-attachment.entity'
import { StoredObjectEntity } from '../../database/entities/stored-object.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { ExamAccessService } from '../exams/exam-access.service'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import type { UploadExamAttachmentDto } from './exam-attachment.dto'
import { validateExamAttachment } from './exam-attachment.policy'
import {
  FileValidationService,
  InvalidUploadedFile,
} from '../file-validation/file-validation.service'
import { ValidationUnavailable } from '../file-validation/clamav-scanner.service'
import { WorkflowStoreService } from '../exam-workflow/workflow-store.service'

@Injectable()
export class ExamAttachmentWriterService {
  constructor(
    private readonly database: DataSource,
    private readonly access: ExamAccessService,
    private readonly objects: R2ObjectStorage,
    private readonly audit: OperationalAuditService,
    private readonly validation: FileValidationService,
    private readonly workflow: WorkflowStoreService,
  ) {}

  async upload(
    examId: string,
    dto: UploadExamAttachmentDto,
    file: Express.Multer.File,
    context: CompanyAccessContext,
  ) {
    const exam = await this.access.require(examId, context)
    this.workflow.assertMutable(exam)
    const checked = validateExamAttachment(file)
    try {
      await this.validation.buffered(file.buffer, file.mimetype)
    } catch (error) {
      if (error instanceof InvalidUploadedFile) throw new BadRequestException(error.message)
      if (error instanceof ValidationUnavailable)
        throw new ServiceUnavailableException(
          'Arquivo não liberado: varredura indisponível. Utilize upload retomável para conservar o envio em quarentena.',
        )
      throw error
    }
    if (dto.replacesId && (!dto.expectedVersion || !dto.reason?.trim()))
      throw new BadRequestException('A substituição exige versão e justificativa.')
    if (!dto.replacesId && (dto.expectedVersion !== undefined || dto.reason !== undefined))
      throw new BadRequestException('Versão e justificativa são utilizadas na substituição.')
    if (dto.replacesId) await this.previous(examId, dto, context, this.database.manager)
    const id = randomUUID()
    const object = await this.database.getRepository(StoredObjectEntity).save({
      id,
      companyId: context.companyId,
      examId,
      storageKey: `exam-attachments/${context.companyId}/${examId}/${id}.${checked.extension}`,
      originalName: checked.name,
      contentType: file.mimetype,
      sizeBytes: file.size,
      sha256: checked.sha256,
      status: 'REGISTERED',
      createdByUserId: context.userId,
    })
    try {
      await this.store(object, file, exam.unitId, context)
      return await this.publish(object, dto, exam.unitId, context)
    } catch (error: unknown) {
      // Preserve the inventory and any accepted bytes for reconciliation after partial failures.
      await this.database
        .getRepository(StoredObjectEntity)
        .update(object.id, { status: 'UNREFERENCED' })
      throw error
    }
  }

  private store(
    object: StoredObjectEntity,
    file: Express.Multer.File,
    unitId: string,
    context: CompanyAccessContext,
  ) {
    return this.audit.external(
      context,
      {
        action: 'EXAM_ATTACHMENT_UPLOADED',
        resourceType: 'exam',
        resourceId: object.examId,
        unitId,
        metadata: { objectId: object.id, sizeBytes: object.sizeBytes, payloadHash: object.sha256 },
      },
      () =>
        this.objects.put(object.storageKey, {
          body: file.buffer,
          contentType: file.mimetype,
          cacheControl: 'private, no-store',
          metadata: { sha256: object.sha256 },
        }),
    )
  }

  publish(
    object: StoredObjectEntity,
    dto: UploadExamAttachmentDto,
    unitId: string,
    context: CompanyAccessContext,
  ) {
    return this.workflow.writable(object.examId!, context, async (_exam, manager) => {
      const previous = dto.replacesId
        ? await this.previous(object.examId!, dto, context, manager, true)
        : null
      const saved = await manager.getRepository(ExamAttachmentEntity).save({
        companyId: context.companyId,
        examId: object.examId!,
        objectId: object.id,
        category: dto.category,
        version: previous ? previous.version + 1 : 1,
        replacesId: previous?.id ?? null,
        supersededAt: null,
        validationStatus: 'APPROVED',
        reason: dto.reason?.trim() ?? null,
        createdByUserId: context.userId,
      })
      if (previous)
        await manager
          .getRepository(ExamAttachmentEntity)
          .update(previous.id, { supersededAt: new Date() })
      await manager.getRepository(StoredObjectEntity).update(object.id, { status: 'STORED' })
      await this.audit.record(
        context,
        {
          action: previous ? 'EXAM_ATTACHMENT_REPLACED' : 'EXAM_ATTACHMENT_CREATED',
          resourceType: 'exam',
          resourceId: object.examId,
          unitId,
          reason: saved.reason,
          metadata: {
            attachmentId: saved.id,
            objectId: object.id,
            category: saved.category,
            version: saved.version,
            previousId: previous?.id ?? null,
          },
        },
        manager,
      )
      return { id: saved.id, version: saved.version }
    })
  }

  private async previous(
    examId: string,
    dto: UploadExamAttachmentDto,
    context: CompanyAccessContext,
    manager: EntityManager,
    lock = false,
  ) {
    const previous = await manager.getRepository(ExamAttachmentEntity).findOne({
      where: { id: dto.replacesId, examId, companyId: context.companyId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    })
    if (!previous) throw new NotFoundException('Anexo original não encontrado.')
    if (previous.supersededAt || previous.version !== dto.expectedVersion)
      throw new ConflictException('Este anexo já foi substituído. Atualize a lista.')
    if (previous.category !== dto.category)
      throw new BadRequestException('Preserve a categoria do anexo original.')
    return previous
  }
}
