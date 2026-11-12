import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { AccessRoleEntity } from '../../database/entities/access-role.entity'
import { CompanyMembershipEntity } from '../../database/entities/company-membership.entity'
import { initialCompanyId } from '../../database/migrations/schema/legacy-company-mapping'
import { CryptoService } from './crypto.service'

@Injectable()
export class AdminAccountProvisioner implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAccountProvisioner.name)

  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureAdmin()
  }

  async ensureAdmin(): Promise<void> {
    const email = this.config.getOrThrow<string>('ADMIN_EMAIL').trim().toLowerCase()
    const repository = this.database.getRepository(AuthUserEntity)
    const existing = await repository.findOneBy({ email })
    if (existing) {
      if (existing.role !== 'ADMIN')
        throw new Error('ADMIN_EMAIL já pertence a uma conta sem administração da plataforma.')
      // Bootstrap does not reset a password or re-enable an explicitly disabled account.
      return
    }
    const passwordHash = await this.crypto.hashPassword(
      this.config.getOrThrow<string>('ADMIN_PASSWORD'),
    )
    await this.database.transaction(async (manager) => {
      const accessRole = await manager.getRepository(AccessRoleEntity).findOneByOrFail({
        companyId: initialCompanyId,
        code: 'ADMINISTRATOR',
      })
      const user = await manager.getRepository(AuthUserEntity).save(
        manager.getRepository(AuthUserEntity).create({
          email,
          fullName: 'Administrador',
          passwordHash,
          status: 'ACTIVE',
          role: 'ADMIN',
          accessRoleId: accessRole.id,
          mustChangePassword: false,
        }),
      )
      await manager.getRepository(CompanyMembershipEntity).save({
        companyId: initialCompanyId,
        userId: user.id,
        accessRoleId: accessRole.id,
        active: true,
        allUnits: true,
      })
    })
    this.logger.log('Conta de administração da plataforma provisionada.')
  }
}
