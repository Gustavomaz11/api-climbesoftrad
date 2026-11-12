import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Header,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { PatientImportService } from './patient-import.service'
import { UndoImportRowDto, ReviewImportRowDto, CommitImportDto } from './dto/patient-import.dto'
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@RequirePermissions('patients.import')
@Controller('patient-imports')
export class PatientImportController {
  constructor(private readonly imports: PatientImportService) {}
  @Get() list(@Req() req: CompanyAuthenticatedRequest) {
    return this.imports.list(req.auth)
  }
  @Get('template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="identificadores.csv"')
  template() {
    return 'unitId;issuer;externalId;patientId;legacyIssuer;legacyExternalId\n'
  }
  @Post() @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2_000_000 } })) preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('Selecione o CSV.')
    return this.imports.preview(file.originalname, file.buffer.toString('utf8'), req.auth)
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string, @Req() req: CompanyAuthenticatedRequest) {
    return this.imports.get(id, req.auth)
  }
  @Put(':id/rows/:rowId') review(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() dto: ReviewImportRowDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.imports.reviewRow(id, rowId, dto, req.auth)
  }
  @Post(':id/rows/:rowId/undo') undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() dto: UndoImportRowDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.imports.undoRow(id, rowId, dto, req.auth)
  }
  @Post(':id/approve-ready') approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.imports.approveReady(id, req.auth)
  }
  @Post(':id/commit') commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommitImportDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.imports.commit(id, dto.limit, req.auth)
  }
}
