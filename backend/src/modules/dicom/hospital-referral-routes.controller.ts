import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { CompanyContextGuard } from '../companies/company-context.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { HospitalReferralRoutesService } from './hospital-referral-routes.service'
import { ConfigureHospitalReferralDto } from './hospital-referral.dto'

@Controller('hospital/referral-routes')
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
export class HospitalReferralRoutesController {
  constructor(private readonly routes: HospitalReferralRoutesService) {}
  @Get() @RequirePermissions('hospital.intake.view') list(@Req() request: CompanyAuthenticatedRequest) {
    return this.routes.list(request.auth)
  }
  @Post() @RequirePermissions('hospital.referrals.manage') configure(@Body() dto: ConfigureHospitalReferralDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.routes.configure(dto, request.auth)
  }
}
