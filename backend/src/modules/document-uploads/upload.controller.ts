import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import { isUUID } from 'class-validator'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { CompanyContextGuard } from '../companies/company-context.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { CreateUploadDto } from './upload.dto'
import { UploadSessionsService } from './upload-sessions.service'
import { UploadValidationWorker } from './upload-validation-worker.service'
import { UploadPartProxyService } from './upload-part-proxy.service'
@Controller('uploads')
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
export class UploadController {
  constructor(
    private readonly sessions: UploadSessionsService,
    private readonly worker: UploadValidationWorker,
    private readonly parts: UploadPartProxyService,
  ) {}
  @Put(':id/parts/:number')
  putPart(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('number', ParseIntPipe) number: number,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.parts.put(id, number, r)
  }
  @Get() list(@Req() r: CompanyAuthenticatedRequest, @Query('examId') examId?: string) {
    if (examId && !isUUID(examId)) throw new BadRequestException('Exame inválido.')
    return this.sessions.list(r.auth, examId)
  }
  @Get('limits') limits() {
    return this.sessions.limits()
  }
  @Post() create(@Body() dto: CreateUploadDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.sessions.create(dto, request.auth)
  }
  @Get(':id') get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.sessions.get(id, request.auth)
  }
  @Post(':id/parts/:number') sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('number', ParseIntPipe) number: number,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.sessions.sign(id, number, request.auth)
  }
  @Post(':id/complete') complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.sessions.complete(id, request.auth)
  }
  @Post(':id/cancel') cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.sessions.cancel(id, request.auth)
  }
  @Post(':id/reprocess')
  @RequirePermissions('documents.validation.manage')
  retry(@Param('id', ParseUUIDPipe) id: string, @Req() request: CompanyAuthenticatedRequest) {
    return this.worker.retry(id, request.auth)
  }
}
