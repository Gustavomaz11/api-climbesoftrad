import { Module } from '@nestjs/common'
import { CompanyAccessModule } from '../companies/company-access.module'
import { WorkflowStoreService } from './workflow-store.service'

@Module({
  imports: [CompanyAccessModule],
  providers: [WorkflowStoreService],
  exports: [WorkflowStoreService],
})
export class WorkflowCoreModule {}
