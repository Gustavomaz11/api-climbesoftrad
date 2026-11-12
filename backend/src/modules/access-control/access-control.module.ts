import { Module } from '@nestjs/common'
import { CompaniesModule } from '../companies/companies.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AccessPermissionEntity } from '../../database/entities/access-permission.entity'
import { AccessRoleEntity } from '../../database/entities/access-role.entity'
import { AuthRefreshTokenEntity } from '../../database/entities/auth-refresh-token.entity'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { OAuthAuthorizationCodeEntity } from '../../database/entities/oauth-authorization-code.entity'
import { AuthModule } from '../auth/auth.module'
import { AccessControlController } from './access-control.controller'
import { AccessControlService } from './access-control.service'

@Module({
  imports: [
    CompaniesModule,
    CompanyAccessModule,
    TypeOrmModule.forFeature([
      AccessPermissionEntity,
      AccessRoleEntity,
      AuthUserEntity,
      AuthSessionEntity,
      AuthRefreshTokenEntity,
      OAuthAuthorizationCodeEntity,
    ]),
    AuthModule,
  ],
  controllers: [AccessControlController],
  providers: [AccessControlService],
})
export class AccessControlModule {}
