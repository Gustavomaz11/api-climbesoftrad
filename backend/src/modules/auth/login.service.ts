import { assertPortalAccess } from '../companies/portal-access'
import { CompanyScopeService } from '../companies/company-scope.service'
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, type Repository } from 'typeorm'
import { loginUsernames } from './login-identifiers'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { OAuthAuthorizationCodeEntity } from '../../database/entities/oauth-authorization-code.entity'
import type { AuthorizationCodeResult, RequestMetadata } from './auth.contracts'
import { CryptoService } from './crypto.service'
import type { LoginDto } from './dto/login.dto'
import { OAuthClientService } from './oauth-client.service'
import { SecurityEventRecorder } from './security-event-recorder.service'

const invalidCredentialsMessage = 'Usuário ou senha incorretos.'

@Injectable()
export class LoginService {
  private readonly dummyPasswordHash: Promise<string>

  constructor(
    @InjectRepository(AuthUserEntity)
    private readonly userRepository: Repository<AuthUserEntity>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly cryptoService: CryptoService,
    private readonly oauthClients: OAuthClientService,
    private readonly securityEvents: SecurityEventRecorder,
    private readonly companies: CompanyScopeService,
  ) {
    this.dummyPasswordHash = this.cryptoService.hashPassword('dummy-password-never-used')
  }

  async login(dto: LoginDto, metadata: RequestMetadata): Promise<AuthorizationCodeResult> {
    await this.oauthClients.requireEnabled(dto.clientId)

    const identifier = dto.email.trim()
    const user = await this.userRepository.findOne({
      where: [{ email: identifier }, { username: In(loginUsernames(identifier)) }],
      relations: { accessRole: true },
    })
    const passwordHash = user?.passwordHash ?? (await this.dummyPasswordHash)
    const passwordMatches = await this.cryptoService.verifyPassword(passwordHash, dto.password)
    const now = new Date()
    const isLocked = Boolean(user?.lockedUntil && user.lockedUntil > now)
    const hasCompanyAccess = Boolean(
      user && (user.role === 'ADMIN' || (await this.companies.hasAccess(user.id))),
    )
    const canLogin = Boolean(
      user && user.status === 'ACTIVE' && hasCompanyAccess && !isLocked && passwordMatches,
    )

    if (user?.status === 'DISABLED' && passwordMatches) {
      throw new ForbiddenException('Seu acesso foi revogado. Entre em contato com o administrador.')
    }

    if (user && !hasCompanyAccess && passwordMatches) {
      throw new ForbiddenException(
        'Seu vínculo com a empresa está revogado. Entre em contato com o administrador.',
      )
    }

    if (!canLogin || !user) {
      await this.recordFailedLogin(user, metadata, isLocked)
      throw new UnauthorizedException(invalidCredentialsMessage)
    }

    if (dto.portalKind && user.role !== 'ADMIN') {
      const companies = await this.companies.available(user.id, false)
      const central = companies.find(c => c.id === this.companies.centralCompanyId)
      assertPortalAccess(central?.allowedPortals ?? [], dto.portalKind)
    }
    return this.createAuthorizationCode(user, dto, metadata)
  }

  private async recordFailedLogin(
    user: AuthUserEntity | null,
    metadata: RequestMetadata,
    alreadyLocked: boolean,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (!user) {
        await this.securityEvents.record({ ...metadata, eventType: 'LOGIN_FAILED' }, manager)
        return
      }

      const repository = manager.getRepository(AuthUserEntity)
      const lockedUser = await repository.findOne({
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      })

      if (!lockedUser) {
        return
      }

      let eventType: 'LOGIN_FAILED' | 'ACCOUNT_TEMPORARILY_LOCKED' = 'LOGIN_FAILED'

      if (!alreadyLocked) {
        lockedUser.failedLoginAttempts += 1
        const maxAttempts = this.configService.getOrThrow<number>('MAX_FAILED_LOGIN_ATTEMPTS')

        if (lockedUser.failedLoginAttempts >= maxAttempts) {
          const lockoutSeconds = this.configService.getOrThrow<number>('ACCOUNT_LOCKOUT_SECONDS')
          lockedUser.lockedUntil = new Date(Date.now() + lockoutSeconds * 1000)
          eventType = 'ACCOUNT_TEMPORARILY_LOCKED'
        }

        await repository.save(lockedUser)
      }

      await this.securityEvents.record({ ...metadata, eventType, userId: lockedUser.id }, manager)
    })
  }

  private async createAuthorizationCode(
    user: AuthUserEntity,
    dto: LoginDto,
    metadata: RequestMetadata,
  ): Promise<AuthorizationCodeResult> {
    const authorizationCode = this.cryptoService.createOpaqueToken()
    const ttlSeconds = this.configService.getOrThrow<number>('AUTHORIZATION_CODE_TTL_SECONDS')

    await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(AuthUserEntity)
      const codeRepository = manager.getRepository(OAuthAuthorizationCodeEntity)

      user.failedLoginAttempts = 0
      user.lockedUntil = null
      await userRepository.save(user)
      await codeRepository.save(
        codeRepository.create({
          codeHash: this.cryptoService.sha256Hex(authorizationCode),
          userId: user.id,
          clientId: dto.clientId,
          codeChallenge: dto.codeChallenge,
          codeChallengeMethod: 'S256',
          rememberAccess: dto.remember ?? false,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          consumedAt: null,
        }),
      )
      await this.securityEvents.record(
        { ...metadata, eventType: 'LOGIN_SUCCESS', userId: user.id },
        manager,
      )
    })

    return { authorizationCode, state: dto.state, expiresIn: ttlSeconds }
  }
}
