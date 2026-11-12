import { Module } from '@nestjs/common'
import { HospitalReceiptService } from './hospital-receipt.service'
import { HospitalDicomAccessService } from './hospital-dicom-access.service'
import { HospitalDicomViewerService } from './hospital-dicom-viewer.service'
import { HospitalReferralRoutesService } from './hospital-referral-routes.service'
import { HospitalReferralRoutesController } from './hospital-referral-routes.controller'
import { HospitalReferralPublisher } from './hospital-referral-publisher.service'
import { HospitalIntakeStagingService } from './hospital-intake-staging.service'
import { HospitalIntakesService } from './hospital-intakes.service'
import { HospitalIntakesController } from './hospital-intakes.controller'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { DocumentUploadsModule } from '../document-uploads/document-uploads.module'
import { FileValidationModule } from '../file-validation/file-validation.module'
import { ExamsModule } from '../exams/exams.module'
import { ExamAccessService } from '../exams/exam-access.service'
import { DicomSourcesService } from './dicom-sources.service'
import { DicomStudiesService } from './dicom-studies.service'
import { DicomReviewsService } from './dicom-reviews.service'
import { DicomIngestionService } from './dicom-ingestion.service'
import { OrthancArchiveService } from './orthanc-archive.service'
import { ImageIngestionWorker } from './image-ingestion-worker.service'
import { DicomAgentGuard } from './dicom-agent.guard'
import { DicomAgentController } from './dicom-agent.controller'
import { DicomController } from './dicom.controller'
import { DicomViewerGrantsService } from './dicom-viewer-grants.service'
import { DicomwebProxyService } from './dicomweb-proxy.service'
import { DicomViewerController } from './dicom-viewer.controller'
import { DicomDownloadService } from './dicom-download.service'
import { DicomInstanceRegistrationService } from './dicom-instance-registration.service'
@Module({
  imports: [
    AuthModule,
    CompanyAccessModule,
    DocumentUploadsModule,
    FileValidationModule,
    ExamsModule,
    TypeOrmModule.forFeature([AuthSessionEntity]),
  ],
  providers: [
    HospitalReceiptService,
    HospitalDicomAccessService,
    HospitalDicomViewerService,
    HospitalReferralRoutesService,
    HospitalReferralPublisher,
    HospitalIntakeStagingService,
    HospitalIntakesService,
    DicomSourcesService,
    DicomStudiesService,
    DicomReviewsService,
    DicomIngestionService,
    DicomInstanceRegistrationService,
    OrthancArchiveService,
    ImageIngestionWorker,
    DicomAgentGuard,
    ExamAccessService,
    DicomViewerGrantsService,
    DicomwebProxyService,
    DicomDownloadService,
  ],
  controllers: [DicomAgentController, DicomController, DicomViewerController, HospitalIntakesController, HospitalReferralRoutesController],
  exports: [DicomStudiesService, OrthancArchiveService, DicomViewerGrantsService],
})
export class DicomModule {}
