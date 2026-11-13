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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from './company-context.guard'
import type { CompanyAuthenticatedRequest } from './company-context.contracts'
import { CompanyMembershipReader } from './company-membership-reader'
import { CompanyMembershipService } from './company-membership.service'
import { CompanyUserProvisioner } from './company-user-provisioner'
import {
  MembershipPortalsDto,
  MembershipPreferencesDto,
  MembershipStatusDto,
  MembershipUnitsDto,
  ProvisionCompanyUserDto,
} from './dto/membership.dto'

@ApiTags('Vínculos e usuários da empresa')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('company-memberships')
export class CompanyMembershipsController {
  constructor(
    private readonly reader: CompanyMembershipReader,
    private readonly memberships: CompanyMembershipService,
    private readonly provisioner: CompanyUserProvisioner,
  ) {}

  @Get()
  @RequirePermissions('users.view')
  list(@Req() request: CompanyAuthenticatedRequest) {
    return this.reader.list(request.auth)
  }

  @Get('me')
  async own(@Req() request: CompanyAuthenticatedRequest) {
    const membership = await this.reader.forUser(request.auth.userId, request.auth)
    return this.reader.response(membership, request.auth)
  }

  @Post()
  @RequirePermissions('users.create')
  provision(@Body() dto: ProvisionCompanyUserDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.provisioner.provision(dto, request.auth)
  }

  @Patch(':id/status')
  @RequirePermissions('memberships.manage')
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MembershipStatusDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.memberships.setActive(id, dto.active, request.auth, dto.reason)
  }

  @Put(':id/portals')
  @RequirePermissions('memberships.manage')
  portals(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MembershipPortalsDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.memberships.portals(id, dto.allowedPortals, request.auth)
  }

  @Put(':id/units')
  @RequirePermissions('memberships.manage')
  units(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MembershipUnitsDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.memberships.units(id, dto, request.auth)
  }

  @Put(':id/preferences')
  preferences(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MembershipPreferencesDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.memberships.preferences(id, dto, request.auth)
  }
}
