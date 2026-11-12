import { Module } from '@nestjs/common'
import { CompanyAccessModule } from '../companies/company-access.module'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'
import { readFileSync } from 'node:fs'
import { AuthRefreshTokenEntity } from '../../database/entities/auth-refresh-token.entity'
import { AuthSecurityEventEntity } from '../../database/entities/auth-security-event.entity'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { OAuthAuthorizationCodeEntity } from '../../database/entities/oauth-authorization-code.entity'
import { OAuthClientEntity } from '../../database/entities/oauth-client.entity'
import { AccessPermissionEntity } from '../../database/entities/access-permission.entity'
import { AccessRoleEntity } from '../../database/entities/access-role.entity'
import { AccessTokenService } from './access-token.service'
import { AdminAccountProvisioner } from './admin-account.provisioner'
import { AuthController } from './auth.controller'
import { AuthenticatedUserService } from './authenticated-user.service'
import { AuthorizationCodeExchangeService } from './authorization-code-exchange.service'
import { ChangePasswordService } from './change-password.service'
import { CryptoService } from './crypto.service'
import { AccessTokenGuard } from './guards/access-token.guard'
import { AdminGuard } from './guards/admin.guard'
import { CookieOriginGuard } from './guards/cookie-origin.guard'
import { PasswordChangedGuard } from './guards/password-changed.guard'
import { PermissionGuard } from './guards/permission.guard'
import { LoginService } from './login.service'
import { OAuthClientService } from './oauth-client.service'
import { RefreshCookieService } from './refresh-cookie.service'
import { RefreshSessionService } from './refresh-session.service'
import { RegistrationService } from './registration.service'
import { SecurityEventRecorder } from './security-event-recorder.service'

@Module({
  imports: [
    ConfigModule,
    CompanyAccessModule,
    TypeOrmModule.forFeature([
      AuthUserEntity,
      OAuthClientEntity,
      OAuthAuthorizationCodeEntity,
      AuthSessionEntity,
      AuthRefreshTokenEntity,
      AuthSecurityEventEntity,
      AccessPermissionEntity,
      AccessRoleEntity,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        privateKey: readFileSync(configService.getOrThrow<string>('JWT_PRIVATE_KEY_PATH'), 'utf8'),
        publicKey: readFileSync(configService.getOrThrow<string>('JWT_PUBLIC_KEY_PATH'), 'utf8'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    CryptoService,
    AccessTokenService,
    AdminAccountProvisioner,
    RefreshCookieService,
    OAuthClientService,
    SecurityEventRecorder,
    RegistrationService,
    LoginService,
    AuthorizationCodeExchangeService,
    RefreshSessionService,
    AuthenticatedUserService,
    ChangePasswordService,
    AccessTokenGuard,
    AdminGuard,
    CookieOriginGuard,
    PasswordChangedGuard,
    PermissionGuard,
  ],
  exports: [
    CryptoService,
    AccessTokenService,
    AccessTokenGuard,
    AdminGuard,
    PasswordChangedGuard,
    PermissionGuard,
    AdminAccountProvisioner,
  ],
})
export class AuthModule {}
