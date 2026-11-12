import { PatientsModule } from '../patients/patients.module'
import { WorkflowCoreModule } from '../exam-workflow/workflow-core.module'
import { ExamWorkflowModule } from '../exam-workflow/exam-workflow.module'
import { ContrastProtocolsModule } from '../contrast-protocols/contrast-protocols.module'
import { ExamCatalogModule } from '../exam-catalog/exam-catalog.module'
import { Module } from '@nestjs/common'
import { CompanyAccessModule } from '../companies/company-access.module'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ExamEntity } from '../../database/entities/exam.entity'
import { ExamCommentAttachmentEntity } from '../../database/entities/exam-comment-attachment.entity'
import { ExamCommentEntity } from '../../database/entities/exam-comment.entity'
import { ExamReportPresenceEntity } from '../../database/entities/exam-report-presence.entity'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { PhysicianEntity } from '../../database/entities/physician.entity'
import { HospitalUnitEntity } from '../../database/entities/hospital-unit.entity'
import { AuthModule } from '../auth/auth.module'
import { ExamsController } from './exams.controller'
import { ExamReportsService } from './exam-reports.service'
import { ExamReportPresenceService } from './exam-report-presence.service'
import { ExamCommentsService } from './exam-comments.service'
import { ExamPrescriptionsService } from './exam-prescriptions.service'
import { ExamAccessService } from './exam-access.service'
import { ExamsService } from './exams.service'
import { R2ExamReportStorage } from './r2-exam-report-storage.service'
import { R2ObjectStorage } from './r2-object-storage.service'
import { ReportCompletionController, HospitalResultsController } from './report-completion.controller'
import { ReportCompletionService } from './report-completion.service'
import { ReportDeliveryService } from './report-delivery.service'

@Module({
  imports: [
    WorkflowCoreModule,
    ExamWorkflowModule,
    ContrastProtocolsModule,
    PatientsModule,
    ExamCatalogModule,
    CompanyAccessModule,
    TypeOrmModule.forFeature([
      ExamEntity,
      ExamReportPresenceEntity,
      ExamCommentEntity,
      ExamCommentAttachmentEntity,
      AuthSessionEntity,
      AuthUserEntity,
      PhysicianEntity,
      HospitalUnitEntity,
    ]),
    AuthModule,
  ],
  controllers: [ExamsController, ReportCompletionController, HospitalResultsController],
  providers: [
    ExamsService,
    ExamAccessService,
    ExamReportsService,
    ExamReportPresenceService,
    ExamCommentsService,
    ExamPrescriptionsService,
    R2ObjectStorage,
    R2ExamReportStorage,
    ReportCompletionService,
    ReportDeliveryService,
  ],
  exports: [ExamsService, R2ObjectStorage],
})
export class ExamsModule {}
