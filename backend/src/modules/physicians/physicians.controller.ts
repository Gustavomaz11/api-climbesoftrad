import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { CreatePhysicianDto } from './dto/create-physician.dto'
import { PhysiciansService } from './physicians.service'
import { PhysicianRegistryService, RegistryLookupDto } from './physician-registry.service'

@ApiTags('Médicos')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('physicians')
export class PhysiciansController {
  constructor(private readonly physicians: PhysiciansService, private readonly registry: PhysicianRegistryService) {}

  @Post('registry-lookup')
  @RequirePermissions('physicians.create')
  lookup(@Body() dto: RegistryLookupDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.registry.lookup(dto, request.auth)
  }

  @Get('specialties')
  @RequirePermissions('physicians.view')
  @ApiOperation({ summary: 'Lista as especialidades médicas oficiais ativas' })
  listSpecialties() {
    return this.physicians.listSpecialties()
  }

  @Get()
  @RequirePermissions('physicians.view')
  @ApiOperation({ summary: 'Lista os médicos cadastrados' })
  list(@Req() request: CompanyAuthenticatedRequest) {
    return this.physicians.list(request.auth)
  }

  @Post()
  @RequirePermissions('physicians.create')
  @ApiOperation({ summary: 'Cadastra ou vincula médico com senha inicial temporária' })
  @ApiCreatedResponse({ description: 'Médico cadastrado' })
  create(@Body() dto: CreatePhysicianDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.physicians.create(dto, request.auth)
  }

  @Patch(':id/revoke')
  @RequirePermissions('physicians.status.manage')
  @ApiOperation({ summary: 'Revoga somente o vínculo médico nesta empresa' })
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    return this.physicians.revoke(id, request.auth)
  }

  @Patch(':id/reactivate')
  @RequirePermissions('physicians.status.manage')
  @ApiOperation({ summary: 'Reativa o acesso de um médico' })
  reactivate(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    return this.physicians.reactivate(id, request.auth)
  }
}
