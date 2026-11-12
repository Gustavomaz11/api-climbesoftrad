import { Module } from '@nestjs/common'
import { ExamAttachmentsModule } from '../exam-attachments/exam-attachments.module'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { ExamAccessService } from '../exams/exam-access.service'
import { PatientScopeService } from './patient-scope.service'
import { PatientCandidatesService } from './patient-candidates.service'
import { PatientRecordsService } from './patient-records.service'
import { PatientExamResolverService } from './patient-exam-resolver.service'
import { PatientAssociationUndoService } from './patient-association-undo.service'
import { PatientReviewsService } from './patient-reviews.service'
import { PatientHistoryService } from './patient-history.service'
import { ExamComparativesService } from './exam-comparatives.service'
import { PatientImportValidationService } from './patient-import-validation.service'
import { PatientImportRunnerService } from './patient-import-runner.service'
import { PatientImportService } from './patient-import.service'
import { PatientsController } from './patients.controller'
import { PatientReviewsController } from './patient-reviews.controller'
import { PatientImportController } from './patient-import.controller'
@Module({
  imports: [AuthModule, CompanyAccessModule, ExamAttachmentsModule, TypeOrmModule.forFeature([AuthSessionEntity])],
  providers: [
    PatientScopeService,
    PatientCandidatesService,
    PatientRecordsService,
    PatientExamResolverService,
    PatientReviewsService,
    PatientAssociationUndoService,
    PatientHistoryService,
    ExamComparativesService,
    PatientImportValidationService,
    PatientImportService,
    PatientImportRunnerService,
    R2ObjectStorage,
    ExamAccessService,
  ],
  controllers: [PatientsController, PatientReviewsController, PatientImportController],
  exports: [PatientExamResolverService, PatientHistoryService, ExamComparativesService],
})
export class PatientsModule {}
