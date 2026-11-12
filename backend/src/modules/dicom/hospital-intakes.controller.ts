import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { CompanyContextGuard } from '../companies/company-context.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { HospitalIntakesService } from './hospital-intakes.service'
import { SaveHospitalIntakeDto, SubmitHospitalIntakeDto } from './hospital-intake.dto'
import { HospitalDicomViewerService } from './hospital-dicom-viewer.service'

@Controller('hospital/intakes')
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
export class HospitalIntakesController {
  constructor(private readonly intakes: HospitalIntakesService, private readonly viewer: HospitalDicomViewerService) {}
  @Post(':id/images/viewer') @RequirePermissions('hospital.intake.view') viewImages(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    return this.viewer.create(id, request.auth)
  }
  @Get() @RequirePermissions('hospital.intake.view') list(@Req() r: CompanyAuthenticatedRequest) {
    return this.intakes.list(r.auth)
  }
  @Get(':id') @RequirePermissions('hospital.intake.view') get(@Param('id', ParseUUIDPipe) id: string, @Req() r: CompanyAuthenticatedRequest) {
    return this.intakes.get(id, r.auth)
  }
  @Patch(':id') @RequirePermissions('hospital.intake.view', 'hospital.intake.submit') save(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveHospitalIntakeDto, @Req() r: CompanyAuthenticatedRequest) {
    return this.intakes.save(id, dto, r.auth)
  }
  @Post(':id/submit') @RequirePermissions('hospital.intake.view', 'hospital.intake.submit') submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitHospitalIntakeDto, @Req() r: CompanyAuthenticatedRequest) {
    return this.intakes.submit(id, dto, r.auth)
  }
}
