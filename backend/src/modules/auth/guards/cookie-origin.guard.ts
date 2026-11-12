import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'
import { parseAllowedOrigins } from '../../../config/environment'

@Injectable()
export class CookieOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const setsOrUsesRefreshCookie =
      request.path.endsWith('/token') || request.path.endsWith('/logout')

    if (!setsOrUsesRefreshCookie) {
      return true
    }

    if (request.get('sec-fetch-site') === 'cross-site') {
      throw new ForbiddenException('Origem nÃ£o autorizada.')
    }

    if (request.get('x-requested-with') !== 'XMLHttpRequest') {
      throw new ForbiddenException('RequisiÃ§Ã£o nÃ£o autorizada.')
    }

    const origin = request.get('origin')
    const allowedOrigins = parseAllowedOrigins(
      this.configService.getOrThrow<string>('FRONTEND_ORIGIN'),
    )

    if (!origin || !allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Origem não autorizada.')
    }

    return true
  }
}
