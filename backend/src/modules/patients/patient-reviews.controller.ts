import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { PatientReviewsService } from './patient-reviews.service'
import {
  OpenPatientReviewDto,
  DecidePatientReviewDto,
  UndoPatientLinkDto,
  PatientListQuery,
} from './dto/patient.dto'
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('patient-reviews')
export class PatientReviewsController {
  constructor(private readonly reviews: PatientReviewsService) {}
  @Get() @RequirePermissions('patients.view', 'patients.reconcile') list(
    @Query() query: PatientListQuery,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.reviews.list(req.auth, query.status)
  }
  @Post('patients/:id')
  @RequirePermissions('patients.view', 'exams.view', 'patients.reconcile')
  open(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenPatientReviewDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.reviews.open(id, dto.expectedVersion, dto.reason, req.auth)
  }
  @Post(':id/decision')
  @RequirePermissions('patients.view', 'exams.view', 'patients.reconcile')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecidePatientReviewDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.reviews.decide(id, dto, req.auth)
  }
  @Post('associations/:id/undo')
  @RequirePermissions('patients.view', 'exams.view', 'patients.reconcile')
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UndoPatientLinkDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.reviews.undo(id, dto, req.auth)
  }
}
