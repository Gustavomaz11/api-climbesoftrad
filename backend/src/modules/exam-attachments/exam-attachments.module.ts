import { Module } from '@nestjs/common'
import { WorkflowCoreModule } from '../exam-workflow/workflow-core.module'
import { FileValidationModule } from '../file-validation/file-validation.module'
import { AttachmentRevalidationService } from './attachment-revalidation.service'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { ExamAccessService } from '../exams/exam-access.service'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { ExamAttachmentReaderService } from './exam-attachment-reader.service'
import { ExamAttachmentWriterService } from './exam-attachment-writer.service'
import { ExamAttachmentsController } from './exam-attachments.controller'

@Module({
  imports: [WorkflowCoreModule, FileValidationModule, AuthModule, CompanyAccessModule, TypeOrmModule.forFeature([AuthSessionEntity])],
  controllers: [ExamAttachmentsController],
  providers: [
    AttachmentRevalidationService,
    ExamAccessService,
    R2ObjectStorage,
    ExamAttachmentReaderService,
    ExamAttachmentWriterService,
  ],
  exports: [ExamAttachmentReaderService, ExamAttachmentWriterService],
})
export class ExamAttachmentsModule {}
