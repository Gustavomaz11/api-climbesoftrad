import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import type { AuthenticatedRequest } from '../auth.contracts'
import { DataSource } from 'typeorm'
import { physicianNeedsSignature } from '../../physicians/physician-signature-status'

@Injectable()
export class PasswordChangedGuard implements CanActivate {
  constructor(private readonly db: DataSource) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (request.auth.mustChangePassword) throw new ForbiddenException('Altere sua senha inicial para continuar.')
    if (await physicianNeedsSignature(this.db.manager, request.auth.role, request.auth.userId))
      throw new ForbiddenException('Cadastre a imagem da sua assinatura para continuar.')
    return true
  }
}
