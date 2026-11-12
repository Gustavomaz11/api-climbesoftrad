import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { AuthenticatedRequest } from '../auth.contracts'
import { REQUIRED_PERMISSIONS_KEY } from '../require-permissions.decorator'
import type { PermissionCode } from '../../access-control/permission.catalog'

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    if (required.length === 0) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()

    const granted = new Set(request.auth.permissions)
    if (required.every((permission) => granted.has(permission))) return true

    throw new ForbiddenException('Você não possui permissão para realizar esta ação.')
  }
}
