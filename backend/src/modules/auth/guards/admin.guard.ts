import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import type { AuthenticatedRequest } from '../auth.contracts'

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (request.auth.isPlatformAdmin) return true
    throw new ForbiddenException('Acesso permitido somente para administradores.')
  }
}
