import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { CompanyContextGuard } from '../companies/company-context.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { DicomViewerGrantsService } from './dicom-viewer-grants.service'
import { DicomwebProxyService } from './dicomweb-proxy.service'
import { CreateDicomViewerDto } from './dicom-viewer.dto'
import { DicomDownloadService } from './dicom-download.service'
@Controller()
export class DicomViewerController {
  constructor(
    private readonly grants: DicomViewerGrantsService,
    private readonly proxy: DicomwebProxyService,
    private readonly config: ConfigService,
    private readonly downloads: DicomDownloadService,
  ) {}
  @Post('exams/:examId/images/download')
  @UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
  @RequirePermissions('exams.view', 'attachments.view')
  download(@Param('examId', ParseUUIDPipe) id: string, @Req() r: CompanyAuthenticatedRequest) {
    return this.downloads.ticket(id, r.auth)
  }
  @Get('dicom-download/:token')
  deliver(@Param('token') token: string, @Res() response: Response) {
    return this.downloads.deliver(token, response)
  }
  @Post('exams/:examId/images/viewer')
  @UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
  @RequirePermissions('exams.view', 'exams.viewer.open')
  create(
    @Param('examId', ParseUUIDPipe) id: string,
    @Body() dto: CreateDicomViewerDto,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.grants.create(id, dto.previousExamId, r.auth)
  }
  @Get('dicom-viewer/:token/config')
  async configuration(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.headers(response)
    return this.grants.configuration(token)
  }
  @Get('dicom-viewer/:token/dicom-web/*tail')
  async data(
    @Param('token') token: string,
    @Param('tail') tail: string | string[],
    @Req() request: Request,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    this.headers(response)
    const result = await this.proxy.request(
      token,
      Array.isArray(tail) ? tail.join('/') : tail,
      request.get('Accept'),
      query,
    )
    if (!result.binary) {
      response.type('application/dicom+json').json(result.rows)
      return
    }
    response.setHeader(
      'Content-Type',
      result.response.headers.get('Content-Type') || 'application/octet-stream',
    )
    if (!result.response.body) {
      response.status(502).end()
      return
    }
    await pipeline(
      Readable.fromWeb(result.response.body as Parameters<typeof Readable.fromWeb>[0]),
      response,
    )
  }
  private headers(response: Response) {
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    const viewer = this.config.get<string>('OHIF_VIEWER_URL')
    if (viewer) response.setHeader('Access-Control-Allow-Origin', new URL(viewer).origin)
  }
}
