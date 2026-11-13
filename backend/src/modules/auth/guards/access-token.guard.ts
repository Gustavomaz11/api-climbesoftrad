import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import type { Repository } from 'typeorm'
import { parsePortalKind } from '../../companies/portal-access'
import { AuthSessionEntity } from '../../../database/entities/auth-session.entity'
import { AccessTokenService } from '../access-token.service'
import type { AuthenticatedRequest } from '../auth.contracts'

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly accessTokens: AccessTokenService,
    @InjectRepository(AuthSessionEntity)
    private readonly sessionRepository: Repository<AuthSessionEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const authorization = request.get('authorization')
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Access token ausente ou inválido.')
    }
    const portalKind = parsePortalKind(request.get('X-Portal-Kind'))
    try {
      const claims = await this.accessTokens.verify(authorization.slice(7))
      const session = await this.sessionRepository.findOne({
        where: { id: claims.sid, userId: claims.sub },
        relations: { user: true },
      })
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        session.user.status !== 'ACTIVE'
      ) {
        throw new UnauthorizedException('Sessão inválida ou expirada.')
      }
      ;(request as AuthenticatedRequest).auth = {
        portalKind,
        userId: claims.sub,
        sessionId: claims.sid,
        role: session.user.role,
        mustChangePassword: session.user.mustChangePassword,
        isPlatformAdmin: session.user.role === 'ADMIN',
        correlationId: randomUUID(),
        accessRoleId: '',
        accessRoleName: '',
        permissions: [],
      }
      return true
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error
      throw new UnauthorizedException('Access token ausente ou inválido.')
    }
  }
}
