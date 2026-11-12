import { Body, Controller, Get, Query, Req, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsOptional, IsUUID } from 'class-validator'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from './company-context.guard'
import type { CompanyAuthenticatedRequest } from './company-context.contracts'
import { CompanyPresentationService } from './company-presentation.service'
import { SaveCompanySettingsDto } from './dto/company.dto'

class SettingsQuery {
  @IsOptional()
  @IsUUID()
  unitId?: string
}

@ApiTags('Configurações da empresa')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('company-settings')
export class CompanySettingsController {
  constructor(private readonly presentation: CompanyPresentationService) {}

  @Get()
  @RequirePermissions('company.settings.view')
  get(@Query() query: SettingsQuery, @Req() request: CompanyAuthenticatedRequest) {
    return this.presentation.get(request.auth, query.unitId)
  }

  @Put()
  @RequirePermissions('company.settings.manage')
  save(@Body() dto: SaveCompanySettingsDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.presentation.save(dto, request.auth)
  }
}
