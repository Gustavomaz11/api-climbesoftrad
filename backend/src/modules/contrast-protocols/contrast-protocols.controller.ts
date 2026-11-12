import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import {
  ActivateContrastProtocolDto,
  CreateContrastProtocolDto,
  RetireContrastProtocolDto,
  SelectContrastProtocolDto,
} from './contrast-protocol.dto'
import { ContrastProtocolsService } from './contrast-protocols.service'
import { PrescriptionProtocolsService } from './prescription-protocols.service'
@ApiTags('Protocolos de contraste')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller()
export class ContrastProtocolsController {
  constructor(
    private readonly protocols: ContrastProtocolsService,
    private readonly prescriptions: PrescriptionProtocolsService,
  ) {}
  @Get('contrast-protocols') @RequirePermissions('contrast.protocols.view') list(
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.protocols.list(req.auth)
  }
  @Post('contrast-protocols') @RequirePermissions('contrast.protocols.manage') create(
    @Body() dto: CreateContrastProtocolDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.protocols.create(dto, req.auth)
  }
  @Post('contrast-protocols/:id/activate')
  @RequirePermissions('contrast.protocols.activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActivateContrastProtocolDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.protocols.activate(id, dto, req.auth)
  }
  @Post('contrast-protocols/:id/retire') @RequirePermissions('contrast.protocols.activate') retire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetireContrastProtocolDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.protocols.retire(id, dto, req.auth)
  }
  @Get('exams/:id/contrast-protocols')
  @RequirePermissions('exams.view', 'contrast.protocols.view')
  forExam(@Param('id', ParseUUIDPipe) id: string, @Req() req: CompanyAuthenticatedRequest) {
    return this.prescriptions.forExam(id, req.auth)
  }
  @Post('exams/:id/prescription/protocol')
  @RequirePermissions('exams.view', 'prescriptions.edit', 'contrast.protocols.view')
  select(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelectContrastProtocolDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.prescriptions.select(id, dto, req.auth)
  }
}
