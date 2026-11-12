import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import type { CompanyAuthenticatedRequest } from './company-context.contracts'
import { CompanyScopeService } from './company-scope.service'

@Injectable()
export class CompanyContextGuard implements CanActivate {
  constructor(private readonly companies: CompanyScopeService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<CompanyAuthenticatedRequest>()
    request.auth = await this.companies.resolve(
      request.auth,
      request.get('X-Company-Id'),
      request.get('X-Unit-Id'),
    )
    return true
  }
}
