import { Body, Controller, ForbiddenException, Param, ParseUUIDPipe, Post, Req, StreamableFile, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { Throttle } from '@nestjs/throttler'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { ActivateRouterDto, RouterActivationService } from './router-activation.service'
import { RouterInstallerService } from './router-installer.service'

@Controller('hospital-units')
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
export class RouterInstallerController {
  constructor(private readonly installers: RouterInstallerService) {}
  @Post(':id/router-installer') @RequirePermissions('units.create')
  async download(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    const result = await this.installers.prepare(id, request.auth), info = await stat(result.file)
    return new StreamableFile(createReadStream(result.file), { type: 'application/x-msi',
      disposition: `attachment; filename="${result.filename}"`, length: info.size })
  }
}
@Controller('router')
export class RouterActivationController {
  constructor(private readonly activation: RouterActivationService) {}
  @Post('activate')
  @Throttle({ burst: { limit: 10, ttl: 10000 }, default: { limit: 30, ttl: 60000 }, sustained: { limit: 100, ttl: 900000 } })
  activate(@Body() dto: ActivateRouterDto, @Req() request: Request) {
    if (!request.secure) throw new ForbiddenException('A ativação do Router exige HTTPS.')
    return this.activation.activate(dto)
  }
}
