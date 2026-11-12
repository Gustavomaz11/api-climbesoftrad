import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CnpjLookupDto, CreateHospitalUnitDto } from './dto/create-hospital-unit.dto'
import { CnpjaService } from './cnpja.service'
import { HospitalUnitsService } from './hospital-units.service'

@ApiTags('Unidades hospitalares')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('hospital-units')
export class HospitalUnitsController {
  constructor(private readonly units: HospitalUnitsService, private readonly cnpja: CnpjaService) {}
  @Post('cnpj-lookup') @RequirePermissions('units.create')
  lookup(@Body() dto: CnpjLookupDto) { return this.cnpja.lookup(dto.cnpj) }

  @Get()
  @RequirePermissions('units.view')
  @ApiOperation({ summary: 'Lista as unidades hospitalares ativas' })
  list(@Req() request: CompanyAuthenticatedRequest) {
    return this.units.list(request.auth)
  }

  @Get('admin')
  @RequirePermissions('units.view')
  @ApiOperation({ summary: 'Lista todas as unidades para administração' })
  listAll(@Req() request: CompanyAuthenticatedRequest) {
    return this.units.listAll(request.auth)
  }

  @Post()
  @RequirePermissions('units.create')
  @ApiOperation({ summary: 'Cadastra uma unidade hospitalar' })
  @ApiCreatedResponse({ description: 'Unidade hospitalar cadastrada' })
  create(@Body() dto: CreateHospitalUnitDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.units.create(dto, request.auth)
  }

  @Put(':id')
  @RequirePermissions('units.create')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateHospitalUnitDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.units.update(id, dto, request.auth)
  }

  @Patch(':id/revoke')
  @RequirePermissions('units.status.manage')
  @ApiOperation({ summary: 'Revoga uma unidade hospitalar' })
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    return this.units.revoke(id, request.auth)
  }

  @Patch(':id/reactivate')
  @RequirePermissions('units.status.manage')
  @ApiOperation({ summary: 'Reativa uma unidade hospitalar' })
  reactivate(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    return this.units.reactivate(id, request.auth)
  }
}
