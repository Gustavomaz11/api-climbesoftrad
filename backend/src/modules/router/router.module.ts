import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { RouterInstallerController, RouterActivationController } from './router.controller'
import { RouterInstallerService } from './router-installer.service'
import { RouterConnectionsService } from './router-connections.service'
import { RouterActivationService } from './router-activation.service'
import { RouterCryptoService } from './router-crypto.service'
import { RouterMsiService } from './router-msi.service'

@Module({ imports: [AuthModule, CompanyAccessModule, TypeOrmModule.forFeature([AuthSessionEntity])], controllers: [RouterInstallerController, RouterActivationController],
  providers: [RouterInstallerService, RouterConnectionsService, RouterActivationService, RouterCryptoService, RouterMsiService],
  exports: [RouterInstallerService, RouterConnectionsService] })
export class RouterModule {}
