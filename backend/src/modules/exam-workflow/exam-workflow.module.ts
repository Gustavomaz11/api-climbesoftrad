import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { WorkflowCoreModule } from './workflow-core.module'
import { ExamWorkflowController } from './exam-workflow.controller'
import { ExamWorkflowService } from './exam-workflow.service'
import { PreparationPoliciesService } from './preparation-policies.service'
import { PreparationEvidenceService } from './preparation-evidence.service'
import { PreparationChecklistService } from './preparation-checklist.service'
import { WorkflowFieldsService } from './workflow-fields.service'
import { WorkflowIssuesService } from './workflow-issues.service'
import { WorkflowIssueEvidenceService } from './workflow-issue-evidence.service'
import { WorkflowNotificationsService } from './workflow-notifications.service'
import { WorkflowOptionsService } from './workflow-options.service'

@Module({
  imports: [
    AuthModule,
    CompanyAccessModule,
    WorkflowCoreModule,
    TypeOrmModule.forFeature([AuthSessionEntity]),
  ],
  controllers: [ExamWorkflowController],
  providers: [
    ExamWorkflowService,
    PreparationPoliciesService,
    PreparationEvidenceService,
    PreparationChecklistService,
    WorkflowFieldsService,
    WorkflowIssuesService,
    WorkflowIssueEvidenceService,
    WorkflowNotificationsService,
    WorkflowOptionsService,
    R2ObjectStorage,
  ],
  exports: [PreparationChecklistService],
})
export class ExamWorkflowModule {}
