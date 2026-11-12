import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { CompanyContextGuard } from '../companies/company-context.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { DicomSourcesService } from './dicom-sources.service'
import { DicomStudiesService } from './dicom-studies.service'
import { DicomReviewsService } from './dicom-reviews.service'
import { CreateDicomSourceDto } from './dicom-source.dto'
import { CompleteDicomStudyDto, ResolveDicomReviewDto } from './dicom-review.dto'
@Controller()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
export class DicomController {
  @Post('exams/:examId/images/retry-archive')
  @RequirePermissions('exams.view', 'dicom.import')
  retryArchive(@Param('examId', ParseUUIDPipe) id: string, @Req() r: CompanyAuthenticatedRequest) {
    return this.studies.retryArchive(id, r.auth)
  }
  constructor(
    private readonly sources: DicomSourcesService,
    private readonly studies: DicomStudiesService,
    private readonly reviews: DicomReviewsService,
  ) {}
  @Get('dicom-sources') @RequirePermissions('dicom.sources.manage') list(
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.sources.list(r.auth)
  }
  @Post('dicom-sources') @RequirePermissions('dicom.sources.manage') create(
    @Body() dto: CreateDicomSourceDto,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.sources.create(dto, r.auth)
  }
  @Post('dicom-sources/:id/revoke') @RequirePermissions('dicom.sources.manage') revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.sources.revoke(id, r.auth)
  }
  @Get('exams/:examId/images') @RequirePermissions('exams.view') images(
    @Param('examId', ParseUUIDPipe) id: string,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.studies.forExam(id, r.auth)
  }
  @Post('exams/:examId/images/complete') @RequirePermissions('exams.view', 'dicom.import') complete(
    @Param('examId', ParseUUIDPipe) id: string,
    @Body() dto: CompleteDicomStudyDto,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.studies.complete(id, dto.reason, r.auth)
  }
  @Get('dicom-reviews') @RequirePermissions('dicom.review') reviewList(
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.reviews.list(r.auth)
  }
  @Post('dicom-reviews/:id/resolve') @RequirePermissions('dicom.review') resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDicomReviewDto,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.reviews.resolve(id, dto, r.auth)
  }
}
