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
import type { AuthenticatedRequest } from '../auth/auth.contracts'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { AdminGuard } from '../auth/guards/admin.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompaniesService } from './companies.service'
import { CompanyContextGuard } from './company-context.guard'
import type { CompanyAuthenticatedRequest } from './company-context.contracts'
import { CompanyStatusDto, SaveCompanyDto } from './dto/company.dto'

@ApiTags('Empresas')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.companies.list(request.auth)
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: SaveCompanyDto, @Req() request: AuthenticatedRequest) {
    return this.companies.create(dto.name, request.auth)
  }

  @Put(':id')
  @UseGuards(CompanyContextGuard, PermissionGuard)
  @RequirePermissions('companies.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveCompanyDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.companies.update(id, dto.name, request.auth)
  }

  @Patch(':id/status')
  @UseGuards(AdminGuard)
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompanyStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.companies.setActive(id, dto.active, dto.reason, request.auth)
  }
}
