import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { AuthRefreshTokenEntity } from '../../database/entities/auth-refresh-token.entity'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { OAuthAuthorizationCodeEntity } from '../../database/entities/oauth-authorization-code.entity'
import { AccessTokenService } from './access-token.service'
import type { AccessTokenResult, RequestMetadata } from './auth.contracts'
import { CryptoService } from './crypto.service'
import type { AuthorizationCodeTokenDto } from './dto/authorization-code-token.dto'
import { OAuthClientService } from './oauth-client.service'
import { SecurityEventRecorder } from './security-event-recorder.service'

type ExchangeResult =
  { kind: 'invalid-pkce'; userId: string } | { kind: 'success'; tokens: AccessTokenResult }

@Injectable()
export class AuthorizationCodeExchangeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly cryptoService: CryptoService,
    private readonly accessTokens: AccessTokenService,
    private readonly oauthClients: OAuthClientService,
    private readonly securityEvents: SecurityEventRecorder,
  ) {}

  async exchange(
    dto: AuthorizationCodeTokenDto,
    metadata: RequestMetadata,
  ): Promise<AccessTokenResult> {
    const codeHash = this.cryptoService.sha256Hex(dto.authorizationCode)
    const result: ExchangeResult = await this.dataSource.transaction(async (manager) => {
      await this.oauthClients.requireEnabled(dto.clientId, manager)
      const codeRepository = manager.getRepository(OAuthAuthorizationCodeEntity)
      const authorizationCode = await codeRepository.findOne({
        where: { codeHash },
        lock: { mode: 'pessimistic_write' },
      })

      if (
        !authorizationCode ||
        authorizationCode.consumedAt ||
        authorizationCode.expiresAt <= new Date() ||
        authorizationCode.clientId !== dto.clientId
      ) {
        throw new UnauthorizedException('Código de autorização inválido ou expirado.')
      }

      const user = await manager.getRepository(AuthUserEntity).findOne({
        where: { id: authorizationCode.userId, status: 'ACTIVE' },
        relations: { accessRole: true },
      })
      if (!user) {
        throw new UnauthorizedException('Código de autorização inválido ou expirado.')
      }

      const calculatedChallenge = this.cryptoService.createPkceChallenge(dto.codeVerifier)

      if (!this.cryptoService.safeEqual(calculatedChallenge, authorizationCode.codeChallenge)) {
        return { kind: 'invalid-pkce' as const, userId: authorizationCode.userId }
      }

      const now = new Date()
      authorizationCode.consumedAt = now
      await codeRepository.save(authorizationCode)

      const refreshDays = this.configService.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS')
      const sessionRepository = manager.getRepository(AuthSessionEntity)
      const session = await sessionRepository.save(
        sessionRepository.create({
          userId: authorizationCode.userId,
          clientId: dto.clientId,
          tokenFamilyId: randomUUID(),
          persistent: authorizationCode.rememberAccess,
          expiresAt: new Date(now.getTime() + refreshDays * 86_400_000),
          lastSeenAt: now,
          revokedAt: null,
          revocationReason: null,
        }),
      )

      const refreshToken = this.cryptoService.createOpaqueToken()
      const refreshRepository = manager.getRepository(AuthRefreshTokenEntity)
      await refreshRepository.save(
        refreshRepository.create({
          sessionId: session.id,
          tokenHash: this.cryptoService.sha256Hex(refreshToken),
          parentTokenId: null,
          expiresAt: session.expiresAt,
          consumedAt: null,
          revokedAt: null,
        }),
      )

      const accessToken = await this.accessTokens.sign(authorizationCode.userId, session.id)
      await this.securityEvents.record(
        {
          ...metadata,
          eventType: 'TOKEN_EXCHANGED',
          userId: authorizationCode.userId,
          sessionId: session.id,
        },
        manager,
      )

      return {
        kind: 'success' as const,
        tokens: {
          accessToken,
          tokenType: 'Bearer' as const,
          expiresIn: this.accessTokens.ttlSeconds,
          refreshToken,
          persistent: session.persistent,
        },
      }
    })

    if (result.kind === 'invalid-pkce') {
      await this.securityEvents.record({
        ...metadata,
        eventType: 'INVALID_PKCE',
        userId: result.userId,
      })
      throw new UnauthorizedException('Falha na validação PKCE.')
    }

    return result.tokens
  }
}
