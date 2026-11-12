import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { CompanyContextGuard } from '../companies/company-context.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { ReportCompletionService } from './report-completion.service'
import { ReportDeliveryService } from './report-delivery.service'
import { FinalizeReportDto, SendReportDto } from './report-completion.contracts'

@Controller('exams')
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
export class ReportCompletionController {
  constructor(private readonly completion: ReportCompletionService, private readonly delivery: ReportDeliveryService) {}
  @Get(':id/report/completion') @RequirePermissions('reports.view') get(@Param('id', ParseUUIDPipe) id: string, @Req() r: CompanyAuthenticatedRequest) { return this.delivery.get(id, r.auth) }
  @Post(':id/report/finalize') @RequirePermissions('reports.finalize', 'reports.edit') finalize(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FinalizeReportDto, @Req() r: CompanyAuthenticatedRequest) { return this.completion.finalize(id, dto, r.auth) }
  @Post(':id/report/send') @RequirePermissions('reports.deliver') send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendReportDto, @Req() r: CompanyAuthenticatedRequest) { return this.delivery.send(id, dto, r.auth) }
}

@Controller('hospital/results')
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
export class HospitalResultsController {
  constructor(private readonly delivery: ReportDeliveryService) {}
  @Get() @RequirePermissions('hospital.results.view') list(@Req() r: CompanyAuthenticatedRequest) { return this.delivery.listHospital(r.auth) }
  @Get(':id') @RequirePermissions('hospital.results.view') get(@Param('id', ParseUUIDPipe) id: string, @Req() r: CompanyAuthenticatedRequest) { return this.delivery.hospitalDocument(id, r.auth) }
}
