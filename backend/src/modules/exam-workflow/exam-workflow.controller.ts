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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { ExamWorkflowService } from './exam-workflow.service'
import { PreparationPoliciesService } from './preparation-policies.service'
import { PreparationChecklistService } from './preparation-checklist.service'
import { WorkflowFieldsService } from './workflow-fields.service'
import { WorkflowIssuesService } from './workflow-issues.service'
import { WorkflowNotificationsService } from './workflow-notifications.service'
import { WorkflowOptionsService } from './workflow-options.service'
import {
  OpenWorkflowIssueDto,
  OperationalFieldsDto,
  PreparationCheckDto,
  PreparationPolicyDto,
  PriorityChangeDto,
  ResolveWorkflowIssueDto,
  VersionedWorkflowDto,
} from './workflow.dto'

@ApiTags('Preparação e fluxo operacional')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller()
export class ExamWorkflowController {
  constructor(
    private readonly workflow: ExamWorkflowService,
    private readonly policies: PreparationPoliciesService,
    private readonly checklist: PreparationChecklistService,
    private readonly fields: WorkflowFieldsService,
    private readonly issues: WorkflowIssuesService,
    private readonly notifications: WorkflowNotificationsService,
    private readonly options: WorkflowOptionsService,
  ) {}

  @Get('workflow-responsibles') @RequirePermissions('exams.view') responsibles(
    @Query('unitId', ParseUUIDPipe) unitId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.options.responsibles(unitId, request.auth)
  }
  @Get('exams/:id/workflow-status') @RequirePermissions('exams.view') status(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.workflow.status(id, request.auth)
  }
  @Get('exams/:id/workflow/evidence') @RequirePermissions('exams.view') evidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.options.evidence(id, request.auth)
  }

  @Get('preparation-policies') @RequirePermissions('exams.view') policiesForUnit(
    @Query('unitId', ParseUUIDPipe) unitId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.policies.list(unitId, request.auth)
  }
  @Post('preparation-policies') @RequirePermissions('exams.preparation.manage') savePolicy(
    @Body() dto: PreparationPolicyDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.policies.save(dto, request.auth)
  }
  @Get('workflow-notifications') @RequirePermissions('exams.view') inbox(
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.notifications.list(request.auth)
  }
  @Post('workflow-notifications/:issueId/acknowledge')
  @RequirePermissions('exams.view')
  acknowledge(
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.notifications.acknowledge(issueId, request.auth)
  }
  @Get('exams/:id/workflow') @RequirePermissions('exams.view') get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.workflow.get(id, request.auth)
  }
  @Post('exams/:id/workflow/check') @RequirePermissions('exams.prepare') check(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreparationCheckDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.checklist.check(id, dto, request.auth)
  }
  @Post('exams/:id/workflow/release') @RequirePermissions('exams.prepare') release(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionedWorkflowDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.workflow.transition(id, 'RELEASE', dto, request.auth)
  }
  @Post('exams/:id/workflow/start') @RequirePermissions('reports.edit') start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionedWorkflowDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.workflow.transition(id, 'START', dto, request.auth)
  }
  @Post('exams/:id/workflow/reopen') @RequirePermissions('exams.prepare') reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionedWorkflowDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.workflow.transition(id, 'REOPEN', dto, request.auth)
  }
  @Post('exams/:id/workflow/cancel') @RequirePermissions('exams.cancel') cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionedWorkflowDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.workflow.transition(id, 'CANCEL', dto, request.auth)
  }
  @Post('exams/:id/workflow/archive') @RequirePermissions('exams.archive') archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionedWorkflowDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.workflow.archive(id, true, dto, request.auth)
  }
  @Post('exams/:id/workflow/unarchive') @RequirePermissions('exams.archive') unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionedWorkflowDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.workflow.archive(id, false, dto, request.auth)
  }
  @Post('exams/:id/workflow/fields') @RequirePermissions('exams.fields.edit') updateFields(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OperationalFieldsDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.fields.fields(id, dto, request.auth)
  }
  @Post('exams/:id/workflow/priority') @RequirePermissions('exams.priority.edit') priority(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PriorityChangeDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.fields.priority(id, dto, request.auth)
  }
  @Post('exams/:id/workflow/issues') @RequirePermissions('exams.issues.manage') openIssue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenWorkflowIssueDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.issues.open(id, dto, request.auth)
  }
  @Post('exams/:id/workflow/issues/:issueId/resolve')
  @RequirePermissions('exams.issues.manage')
  resolveIssue(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() dto: ResolveWorkflowIssueDto,
    @Req() request: CompanyAuthenticatedRequest,
  ) {
    return this.issues.resolve(id, issueId, dto, request.auth)
  }
}
