import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { CompanyContextGuard } from '../companies/company-context.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { ReportReasonDto, ReportRevisionDto, ReportAuthorizationDto, ReportCloseDto, ReportActivityDto } from './report-lifecycle.contracts'
import { ReportReviewService } from './report-review.service'
import { ReportHistoryService } from './report-history.service'
import { ExamReportsService } from './exam-reports.service'
import { ReportSessionStore } from '../exam-workflow/report-session-store.service'
import { reportReason } from './report-revision.policy'

@Controller()
@UseGuards(AccessTokenGuard,PasswordChangedGuard,CompanyContextGuard,PermissionGuard)
export class ReportLifecycleController {
  constructor(private readonly reviews:ReportReviewService,private readonly history:ReportHistoryService,private readonly reports:ExamReportsService,private readonly sessions:ReportSessionStore){}
  @Post('exams/:id/report/session/close') @RequirePermissions('reports.edit')
  close(@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReportCloseDto,@Req() r:CompanyAuthenticatedRequest){return this.reports.close(id,dto,r.auth)}
  @Post('exams/:id/report/session/force-release') @RequirePermissions('reports.session.force')
  force(@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReportReasonDto,@Req() r:CompanyAuthenticatedRequest){return this.sessions.requestRelease(id,reportReason(dto.reason),r.auth)}
  @Post('report-versions/:id/review') @RequirePermissions('reports.review.request')
  review(@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReportReasonDto,@Req() r:CompanyAuthenticatedRequest){return this.reviews.request(id,dto.reason,r.auth)}
  @Post('exams/:id/report/authorize') @RequirePermissions('reports.review.authorize')
  authorize(@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReportAuthorizationDto,@Req() r:CompanyAuthenticatedRequest){return this.reviews.authorize(id,dto,r.auth)}
  @Post('exams/:id/report/revise') @RequirePermissions('reports.edit','reports.finalize')
  revise(@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReportRevisionDto,@Req() r:CompanyAuthenticatedRequest){return this.reviews.begin(id,dto,r.auth)}
  @Post('exams/:id/report/revalidate') @RequirePermissions('reports.edit','reports.finalize')
  revalidate(@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReportRevisionDto,@Req() r:CompanyAuthenticatedRequest){return this.reviews.revalidate(id,dto,r.auth)}
  @Get('report-versions/:id/history')
  historyForVersion(@Param('id',ParseUUIDPipe) id:string,@Req() r:CompanyAuthenticatedRequest){return this.history.history(id,r.auth)}
  @Get('report-versions/:id')
  version(@Param('id',ParseUUIDPipe) id:string,@Req() r:CompanyAuthenticatedRequest){return this.history.version(id,r.auth)}
  @Post('report-versions/:id/activity')
  activity(@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReportActivityDto,@Req() r:CompanyAuthenticatedRequest){return this.history.activity(id,dto,r.auth)}
}
