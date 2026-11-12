import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { UploadExamAttachmentDto } from './exam-attachment.dto'
import { examAttachmentMaxBytes } from './exam-attachment.policy'
import { ExamAttachmentReaderService } from './exam-attachment-reader.service'
import { ExamAttachmentWriterService } from './exam-attachment-writer.service'
import { AttachmentRevalidationService } from './attachment-revalidation.service'

@ApiTags('Anexos do exame')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('exams/:examId/attachments')
export class ExamAttachmentsController {
  constructor(
    private readonly reader: ExamAttachmentReaderService,
    private readonly writer: ExamAttachmentWriterService,
    private readonly revalidation:AttachmentRevalidationService,
  ) {}
  @Post(':id/reprocess') @RequirePermissions('exams.view','attachments.view','documents.validation.manage')
  reprocess(@Param('examId',ParseUUIDPipe) examId:string,@Param('id',ParseUUIDPipe) id:string,@Req() r:CompanyAuthenticatedRequest) {return this.revalidation.validate(examId,id,r.auth)}
  @Get()
  @RequirePermissions('exams.view', 'attachments.view')
  list(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.reader.list(examId, request.auth)
  }
  @Get(':id/access')
  @RequirePermissions('exams.view', 'attachments.view')
  open(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.reader.open(examId, id, request.auth)
  }
  @Post()
  @RequirePermissions('exams.view', 'attachments.upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: examAttachmentMaxBytes } }))
  upload(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: UploadExamAttachmentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('Selecione um PDF ou imagem para anexar.')
    return this.writer.upload(examId, dto, file, request.auth)
  }
}
