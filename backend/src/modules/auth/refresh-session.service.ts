import { Injectable, UnauthorizedException } from '@nestjs/common'
import { DataSource, IsNull, type EntityManager } from 'typeorm'
import { AuthRefreshTokenEntity } from '../../database/entities/auth-refresh-token.entity'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AccessTokenService } from './access-token.service'
import type { AccessTokenResult, RequestMetadata } from './auth.contracts'
import { CryptoService } from './crypto.service'
import { OAuthClientService } from './oauth-client.service'
import { SecurityEventRecorder } from './security-event-recorder.service'

type RotationResult = { kind: 'invalid' | 'reuse' } | { kind: 'success'; tokens: AccessTokenResult }

@Injectable()
export class RefreshSessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cryptoService: CryptoService,
    private readonly accessTokens: AccessTokenService,
    private readonly oauthClients: OAuthClientService,
    private readonly securityEvents: SecurityEventRecorder,
  ) {}

  async refresh(
    clientId: string,
    rawRefreshToken: string,
    metadata: RequestMetadata,
  ): Promise<AccessTokenResult> {
    const tokenHash = this.cryptoService.sha256Hex(rawRefreshToken)
    const result: RotationResult = await this.dataSource.transaction(async (manager) => {
      await this.oauthClients.requireEnabled(clientId, manager)
      const refreshRepository = manager.getRepository(AuthRefreshTokenEntity)
      const refreshToken = await refreshRepository
        .createQueryBuilder('refreshToken')
        .innerJoinAndSelect('refreshToken.session', 'session')
        .innerJoinAndSelect('session.user', 'user')
        .where('refreshToken.token_hash = :tokenHash', { tokenHash })
        .setLock('pessimistic_write')
        .getOne()

      if (!refreshToken) {
        return { kind: 'invalid' as const }
      }

      if (refreshToken.consumedAt || refreshToken.revokedAt) {
        await this.revokeForReuse(refreshToken, metadata, manager)
        return { kind: 'reuse' as const }
      }

      const { session } = refreshToken
      const now = new Date()

      if (
        session.revokedAt ||
        session.expiresAt <= now ||
        refreshToken.expiresAt <= now ||
        session.clientId !== clientId ||
        session.user.status !== 'ACTIVE'
      ) {
        return { kind: 'invalid' as const }
      }

      refreshToken.consumedAt = now
      await refreshRepository.save(refreshToken)

      const rotatedToken = this.cryptoService.createOpaqueToken()
      await refreshRepository.save(
        refreshRepository.create({
          sessionId: session.id,
          tokenHash: this.cryptoService.sha256Hex(rotatedToken),
          parentTokenId: refreshToken.id,
          expiresAt: session.expiresAt,
          consumedAt: null,
          revokedAt: null,
        }),
      )

      session.lastSeenAt = now
      await manager.getRepository(AuthSessionEntity).save(session)
      const accessToken = await this.accessTokens.sign(session.userId, session.id)
      await this.securityEvents.record(
        {
          ...metadata,
          eventType: 'TOKEN_REFRESHED',
          userId: session.userId,
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
          refreshToken: rotatedToken,
          persistent: session.persistent,
        },
      }
    })

    if (result.kind !== 'success') {
      throw new UnauthorizedException('Sessão inválida ou expirada.')
    }

    return result.tokens
  }

  async logout(rawRefreshToken: string | null, metadata: RequestMetadata): Promise<void> {
    if (!rawRefreshToken) {
      return
    }

    const tokenHash = this.cryptoService.sha256Hex(rawRefreshToken)
    await this.dataSource.transaction(async (manager) => {
      const refreshToken = await manager
        .getRepository(AuthRefreshTokenEntity)
        .createQueryBuilder('refreshToken')
        .innerJoinAndSelect('refreshToken.session', 'session')
        .where('refreshToken.token_hash = :tokenHash', { tokenHash })
        .setLock('pessimistic_write')
        .getOne()

      if (!refreshToken || refreshToken.session.revokedAt) {
        return
      }

      const now = new Date()
      refreshToken.session.revokedAt = now
      refreshToken.session.revocationReason = 'LOGOUT'
      await manager.getRepository(AuthSessionEntity).save(refreshToken.session)
      await manager
        .getRepository(AuthRefreshTokenEntity)
        .update({ sessionId: refreshToken.sessionId, revokedAt: IsNull() }, { revokedAt: now })
      await this.securityEvents.record(
        {
          ...metadata,
          eventType: 'LOGOUT',
          userId: refreshToken.session.userId,
          sessionId: refreshToken.sessionId,
        },
        manager,
      )
    })
  }

  private async revokeForReuse(
    refreshToken: AuthRefreshTokenEntity,
    metadata: RequestMetadata,
    manager: EntityManager,
  ): Promise<void> {
    const now = new Date()
    const session = refreshToken.session
    session.revokedAt = session.revokedAt ?? now
    session.revocationReason = 'REFRESH_TOKEN_REUSE'
    await manager.getRepository(AuthSessionEntity).save(session)
    await manager
      .getRepository(AuthRefreshTokenEntity)
      .update({ sessionId: session.id, revokedAt: IsNull() }, { revokedAt: now })
    await this.securityEvents.record(
      {
        ...metadata,
        eventType: 'REFRESH_TOKEN_REUSE_DETECTED',
        userId: session.userId,
        sessionId: session.id,
      },
      manager,
    )
  }
}
