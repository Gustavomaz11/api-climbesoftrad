import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { PatientCandidatesService } from './patient-candidates.service'
import { PatientRecordsService } from './patient-records.service'
import { PatientHistoryService } from './patient-history.service'
import {
  PatientDemographicsDto,
  PatientListQuery,
  CreatePatientDto,
  CorrectPatientDto,
  AddIdentifierDto,
} from './dto/patient.dto'
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly candidates: PatientCandidatesService,
    private readonly records: PatientRecordsService,
    private readonly history: PatientHistoryService,
  ) {}
  @Get() @RequirePermissions('patients.view') list(
    @Query() query: PatientListQuery,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.records.list(req.auth, query.search)
  }
  @Post() @RequirePermissions('patients.manage') create(
    @Body() dto: CreatePatientDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.records.create(dto, req.auth)
  }
  @Get('candidates') @RequirePermissions('patients.view') candidatesFor(
    @Query() query: PatientDemographicsDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.candidates.find(query, req.auth)
  }
  @Get(':id') @RequirePermissions('patients.view') detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.records.detail(id, req.auth)
  }
  @Put(':id') @RequirePermissions('patients.manage') correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectPatientDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.records.correct(id, dto, req.auth)
  }
  @Post(':id/identifiers') @RequirePermissions('patients.identifiers.manage') identifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddIdentifierDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.records.identifier(id, dto, req.auth)
  }
  @Get(':id/history') @RequirePermissions('patients.view', 'exams.view') patientHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.history.list(id, req.auth)
  }
  @Get(':id/history/:examId/availability')
  @RequirePermissions('patients.view', 'exams.view')
  availability(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.history.availability(id, examId, req.auth)
  }
}
