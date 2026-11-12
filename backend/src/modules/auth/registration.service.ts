import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { AccessRoleEntity } from '../../database/entities/access-role.entity'
import { CompanyMembershipEntity } from '../../database/entities/company-membership.entity'
import { initialCompanyId } from '../../database/migrations/schema/legacy-company-mapping'
import { AuthenticatedUserService } from './authenticated-user.service'
import type { RequestMetadata } from './auth.contracts'
import { CryptoService } from './crypto.service'
import type { RegisterDto } from './dto/register.dto'
import { SecurityEventRecorder } from './security-event-recorder.service'

@Injectable()
export class RegistrationService {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly events: SecurityEventRecorder,
    private readonly authenticatedUsers: AuthenticatedUserService,
  ) {}

  async register(dto: RegisterDto, metadata: RequestMetadata) {
    if (!this.config.getOrThrow<boolean>('PUBLIC_REGISTRATION_ENABLED')) {
      throw new ForbiddenException('O cadastro público está desabilitado.')
    }
    const email = dto.email.trim().toLowerCase()
    const passwordHash = await this.crypto.hashPassword(dto.password)
    try {
      const userId = await this.database.transaction(async (manager) => {
        const role = await manager.getRepository(AccessRoleEntity).findOneByOrFail({
          companyId: initialCompanyId,
          code: 'RECEPTION',
          active: true,
        })
        const users = manager.getRepository(AuthUserEntity)
        const user = await users.save(
          users.create({
            email,
            fullName: dto.fullName.trim().replace(/\s+/g, ' '),
            passwordHash,
            status: 'ACTIVE',
            role: 'USER',
            accessRoleId: role.id,
          }),
        )
        await manager.getRepository(CompanyMembershipEntity).save({
          companyId: initialCompanyId,
          userId: user.id,
          accessRoleId: role.id,
          active: true,
          allUnits: true,
        })
        await this.events.record(
          { ...metadata, eventType: 'REGISTER_SUCCESS', userId: user.id },
          manager,
        )
        return user.id
      })
      return this.authenticatedUsers.getById(userId)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new ConflictException('Não foi possível criar a conta com os dados informados.')
      }
      throw error
    }
  }
}
