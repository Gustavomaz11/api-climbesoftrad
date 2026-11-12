import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { DocumentUploadsModule } from '../document-uploads/document-uploads.module'
import { ExamsModule } from '../exams/exams.module'
import { ExamAccessService } from '../exams/exam-access.service'
import { FileValidationModule } from '../file-validation/file-validation.module'
import { DicomModule } from '../dicom/dicom.module'
import { ResearchAiController } from './research-ai.controller'
import { ResearchViewerController } from './research-viewer.controller'
import { ResearchViewerAccess } from './research-viewer-access.service'
import { ResearchAiService } from './research-ai.service'
import { ResearchFrameReviewService } from './research-frame-review.service'
import { ResearchAiWorker } from './research-ai.worker'
import { ResearchAnalysisRunner } from './research-analysis-runner.service'
import { ResearchReanalysisService } from './research-reanalysis.service'
import { ResearchFramePreparer } from './research-frame-preparer.service'
import { ResearchImageStorage } from './research-image-storage.service'
import { LocalTextRedactionService } from './local-text-redaction.service'
import { GeminiResearchClient } from './gemini-research.client'
@Module({
  imports: [
    AuthModule,
    CompanyAccessModule,
    DocumentUploadsModule,
    ExamsModule,
    FileValidationModule,
    DicomModule,
    TypeOrmModule.forFeature([AuthSessionEntity]),
  ],
  controllers: [ResearchAiController, ResearchViewerController],
  providers: [
    ResearchAiService,
    ResearchViewerAccess,
    ResearchFrameReviewService,
    ResearchAiWorker,
    ResearchAnalysisRunner,
    ResearchReanalysisService,
    ResearchFramePreparer,
    ResearchImageStorage,
    LocalTextRedactionService,
    GeminiResearchClient,
    ExamAccessService,
  ],
})
export class ResearchAiModule {}
