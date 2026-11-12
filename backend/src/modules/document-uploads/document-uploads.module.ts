import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { ExamAttachmentsModule } from '../exam-attachments/exam-attachments.module'
import { FileValidationModule } from '../file-validation/file-validation.module'
import { ExamAccessService } from '../exams/exam-access.service'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { UploadSessionsService } from './upload-sessions.service'
import { UploadScopeService } from './upload-scope.service'
import { UploadLiveContextService } from './upload-live-context.service'
import { UploadValidationWorker } from './upload-validation-worker.service'
import { UploadController } from './upload.controller'
import { UploadLifecycleService } from './upload-lifecycle.service'
import { UploadPartProxyService } from './upload-part-proxy.service'
@Module({
  imports: [
    AuthModule,
    CompanyAccessModule,
    ExamAttachmentsModule,
    FileValidationModule,
    TypeOrmModule.forFeature([AuthSessionEntity]),
  ],
  providers: [
    UploadSessionsService,
    UploadPartProxyService,
    UploadLifecycleService,
    UploadScopeService,
    UploadLiveContextService,
    UploadValidationWorker,
    ExamAccessService,
    R2ObjectStorage,
  ],
  controllers: [UploadController],
  exports: [
    UploadSessionsService,
    UploadScopeService,
    UploadLiveContextService,
    UploadValidationWorker,
  ],
})
export class DocumentUploadsModule {}
