import { Module } from '@nestjs/common'
import { CompanyPresentationService } from './company-presentation.service'
import { CompanyContextGuard } from './company-context.guard'
import { CompanyScopeService } from './company-scope.service'
import { OperationalAuditService } from './operational-audit.service'

@Module({
  providers: [
    CompanyPresentationService,
    CompanyScopeService,
    CompanyContextGuard,
    OperationalAuditService,
  ],
  exports: [
    CompanyPresentationService,
    CompanyScopeService,
    CompanyContextGuard,
    OperationalAuditService,
  ],
})
export class CompanyAccessModule {}
