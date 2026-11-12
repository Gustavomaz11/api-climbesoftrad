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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { AccessControlService } from './access-control.service'
import { AssignUserRoleDto } from './dto/assign-user-role.dto'
import { CreateAccessRoleDto } from './dto/create-access-role.dto'
import { UpdateAccessRoleDto } from './dto/update-access-role.dto'

@ApiTags('Cargos e permissões')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('access-control')
export class AccessControlController {
  constructor(private readonly accessControl: AccessControlService) {}

  @Get('permissions')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'Lista o catálogo de permissões' })
  listPermissions() {
    return this.accessControl.listPermissions()
  }

  @Get('roles')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'Lista cargos e suas permissões' })
  listRoles(@Req() request: CompanyAuthenticatedRequest) {
    return this.accessControl.listRoles(request.auth)
  }

  @Post('roles')
  @RequirePermissions('roles.create', 'roles.permissions.manage')
  createRole(@Body() dto: CreateAccessRoleDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.accessControl.createRole(dto, request.auth)
  }

  @Put('roles/:id')
  @RequirePermissions('roles.edit', 'roles.permissions.manage')
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccessRoleDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.accessControl.updateRole(id, dto, request.auth)
  }

  @Patch('roles/:id/revoke')
  @RequirePermissions('roles.status.manage')
  revokeRole(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    return this.accessControl.setRoleActive(id, false, request.auth)
  }

  @Patch('roles/:id/reactivate')
  @RequirePermissions('roles.status.manage')
  reactivateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.accessControl.setRoleActive(id, true, request.auth)
  }

  @Get('users')
  @RequirePermissions('users.view')
  listUsers(@Req() request: CompanyAuthenticatedRequest) {
    return this.accessControl.listUsers(request.auth)
  }

  @Patch('users/:id/role')
  @RequirePermissions('users.roles.assign')
  assignUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignUserRoleDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.accessControl.assignUserRole(id, dto, request.auth)
  }
}
