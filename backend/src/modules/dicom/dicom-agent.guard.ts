import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { DicomSourcesService } from './dicom-sources.service'
export interface DicomAgentRequest extends CompanyAuthenticatedRequest {
  sourceId: string
}
@Injectable()
export class DicomAgentGuard implements CanActivate {
  constructor(private readonly sources: DicomSourcesService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<DicomAgentRequest>(),
      authorization = request.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException()
    const authenticated = await this.sources.authenticate(authorization.slice(7))
    if (authenticated.source.requiresTls && !request.secure) throw new ForbiddenException('O Router exige comunicação HTTPS.')
    request.auth = authenticated.context
    request.sourceId = authenticated.source.id
    return true
  }
}
