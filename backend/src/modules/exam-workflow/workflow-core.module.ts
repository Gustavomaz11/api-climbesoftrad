import { Module } from '@nestjs/common'
import { CompanyAccessModule } from '../companies/company-access.module'
import { WorkflowStoreService } from './workflow-store.service'
import { ReportSessionStore } from './report-session-store.service'

@Module({
  imports: [CompanyAccessModule],
  providers: [WorkflowStoreService, ReportSessionStore],
  exports: [WorkflowStoreService, ReportSessionStore],
})
export class WorkflowCoreModule {}
