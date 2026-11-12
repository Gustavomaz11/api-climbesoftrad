import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import type { CookieSameSite } from '../../config/environment'

@Injectable()
export class RefreshCookieService {
  constructor(private readonly configService: ConfigService) {}

  private get cookieName(): string {
    return this.configService.get<string>('NODE_ENV') === 'production'
      ? '__Host-crm_refresh'
      : 'crm_refresh'
  }

  read(request: Request): string | null {
    const cookies = request.cookies as Record<string, unknown> | undefined
    const value = cookies?.[this.cookieName]
    return typeof value === 'string' ? value : null
  }

  set(response: Response, token: string, persistent: boolean): void {
    const maxAge = this.configService.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS') * 86_400_000
    response.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.configService.getOrThrow<boolean>('COOKIE_SECURE'),
      sameSite: this.configService.getOrThrow<CookieSameSite>('COOKIE_SAME_SITE'),
      path: '/',
      ...(persistent ? { maxAge } : {}),
    })
  }

  clear(response: Response): void {
    response.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.configService.getOrThrow<boolean>('COOKIE_SECURE'),
      sameSite: this.configService.getOrThrow<CookieSameSite>('COOKIE_SAME_SITE'),
      path: '/',
    })
  }
}
