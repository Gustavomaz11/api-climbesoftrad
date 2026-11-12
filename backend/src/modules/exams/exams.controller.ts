import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express'
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { IsUUID } from 'class-validator'
import { PatientHistoryService } from '../patients/patient-history.service'
import { ExamComparativesService } from '../patients/exam-comparatives.service'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CreateExamDto } from './dto/create-exam.dto'
import { CreateExamCommentDto } from './dto/create-exam-comment.dto'
import { ListExamsQueryDto } from './dto/list-exams-query.dto'
import { SaveExamReportDto } from './dto/save-exam-report.dto'
import { SaveExamPrescriptionDto } from './dto/save-exam-prescription.dto'
import { ExamReportsService } from './exam-reports.service'
import { ExamReportPresenceService } from './exam-report-presence.service'
import { ExamCommentsService } from './exam-comments.service'
import { ExamPrescriptionsService } from './exam-prescriptions.service'
import { ExamsService } from './exams.service'

class LinkComparativeDto {
  @IsUUID() comparativeExamId: string
}

@ApiTags('Exames')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('exams')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly history: PatientHistoryService,
    private readonly comparatives: ExamComparativesService,
    private readonly reports: ExamReportsService,
    private readonly reportPresence: ExamReportPresenceService,
    private readonly comments: ExamCommentsService,
    private readonly prescriptions: ExamPrescriptionsService,
  ) {}

  @Get(':id/patient-history') @RequirePermissions('exams.view', 'patients.view') historyForExam(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.history.forExam(id, request.auth)
  }
  @Get(':id/comparatives') @RequirePermissions('exams.view', 'patients.view') listComparatives(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.comparatives.list(id, request.auth)
  }
  @Post(':id/comparatives')
  @RequirePermissions('exams.view', 'comparatives.manage')
  linkComparative(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkComparativeDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.comparatives.link(id, dto.comparativeExamId, request.auth)
  }
  @Delete(':id/comparatives/:linkId') @RequirePermissions('comparatives.manage') removeComparative(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.comparatives.remove(id, linkId, request.auth)
  }

  @Get()
  @RequirePermissions('exams.view')
  @ApiOperation({ summary: 'Lista exames com filtros e paginação' })
  list(@Query() query: ListExamsQueryDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.exams.list(query, request.auth)
  }

  @Post()
  @RequirePermissions('exams.create')
  @ApiOperation({ summary: 'Cadastra um exame realizado' })
  @ApiCreatedResponse({ description: 'Exame cadastrado' })
  create(@Body() dto: CreateExamDto, @Req() request: CompanyAuthenticatedRequest) {
    return this.exams.create(dto, request.auth)
  }

  @Get(':id/comments')
  @RequirePermissions('comments.view')
  @ApiOperation({ summary: 'Lista os comentários e respostas do exame' })
  listComments(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.comments.list(examId, request.auth)
  }

  @Post(':id/comments')
  @RequirePermissions('comments.create')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Adiciona um comentário ou resposta com anexos' })
  @UseInterceptors(FilesInterceptor('attachments', 5, { limits: { fileSize: 10 * 1024 * 1024 } }))
  createComment(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Body() dto: CreateExamCommentDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    if (
      (files?.length ?? 0) > 0 &&
      !request.auth.permissions.includes('comments.attachments.upload')
    ) {
      throw new ForbiddenException('Você não possui permissão para anexar arquivos a comentários.')
    }
    return this.comments.create(examId, dto, files ?? [], request.auth)
  }

  @Get(':id/prescription')
  @RequirePermissions('prescriptions.view')
  @ApiOperation({ summary: 'Carrega a prescrição médica salva no Cloudflare R2' })
  getPrescription(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.prescriptions.get(examId, request.auth)
  }

  @Put(':id/prescription')
  @RequirePermissions('prescriptions.edit')
  @ApiOperation({ summary: 'Salva a prescrição médica e remove uma assinatura anterior' })
  savePrescription(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Body() dto: SaveExamPrescriptionDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.prescriptions.save(examId, dto, request.auth)
  }

  @Put(':id/prescription/sign')
  @RequirePermissions('prescriptions.sign')
  @ApiOperation({ summary: 'Assina a versão atual da prescrição médica' })
  signPrescription(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Body() dto: SaveExamPrescriptionDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.prescriptions.sign(examId, dto, request.auth)
  }

  @Post(':id/prescription/images')
  @RequirePermissions('prescriptions.images.upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Anexa uma imagem à prescrição médica no Cloudflare R2' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  uploadPrescriptionImage(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('Selecione uma imagem para anexar.')
    return this.prescriptions.uploadImage(examId, file, request.auth)
  }

  @Get(':id/report')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Carrega o laudo salvo no Cloudflare R2' })
  getReport(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.reports.get(examId, request.auth)
  }

  @Put(':id/report')
  @RequirePermissions('reports.edit')
  @ApiOperation({ summary: 'Salva o conteúdo atual do laudo no Cloudflare R2' })
  saveReport(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Body() dto: SaveExamReportDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.reports.save(examId, dto, request.auth)
  }

  @Put(':id/report/presence/:clientId')
  @RequirePermissions('reports.edit')
  @ApiOperation({ summary: 'Mantém a presença do usuário no laudário' })
  touchReportPresence(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Param('clientId', new ParseUUIDPipe()) clientId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.reportPresence.touch(examId, request.auth, clientId)
  }

  @Delete(':id/report/presence/:clientId')
  @RequirePermissions('reports.edit')
  @ApiOperation({ summary: 'Encerra a presença do usuário no laudário' })
  releaseReportPresence(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Param('clientId', new ParseUUIDPipe()) clientId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.reportPresence.release(examId, request.auth, clientId)
  }

  @Post(':id/report/images')
  @RequirePermissions('reports.images.upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Anexa uma imagem ao laudo no Cloudflare R2' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  uploadReportImage(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('Selecione uma imagem para anexar.')
    return this.reports.uploadImage(examId, file, request.auth)
  }
}
