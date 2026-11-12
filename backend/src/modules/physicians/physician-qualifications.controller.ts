import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import {
  CreatePhysicianQualificationDto,
  UpdatePhysicianQualificationDto,
} from './dto/physician-qualification.dto'
import { PhysicianQualificationsService } from './physician-qualifications.service'
import { ExamPhysicianEligibilityService } from './exam-physician-eligibility.service'

@ApiTags('Habilitações médicas')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller()
export class PhysicianQualificationsController {
  constructor(
    private readonly qualifications: PhysicianQualificationsService,
    private readonly eligibility: ExamPhysicianEligibilityService,
  ) {}
  @Get('physicians/:id/qualifications')
  @RequirePermissions('physicians.view')
  list(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    return this.qualifications.list(id, request.auth)
  }
  @Post('physicians/:id/qualifications')
  @RequirePermissions('physicians.view', 'physicians.qualifications.manage')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePhysicianQualificationDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.qualifications.create(id, dto, request.auth)
  }
  @Put('physicians/:id/qualifications/:qualificationId')
  @RequirePermissions('physicians.view', 'physicians.qualifications.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('qualificationId', ParseUUIDPipe) qualificationId: string,
    @Body() dto: UpdatePhysicianQualificationDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.qualifications.update(id, qualificationId, dto, request.auth)
  }
  @Get('exams/:id/eligible-physicians')
  @RequirePermissions('exams.view', 'physicians.view')
  eligible(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    return this.eligibility.eligible(id, request.auth)
  }
}
