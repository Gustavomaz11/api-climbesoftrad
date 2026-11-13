import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { OpenWorkflowIssueDto, ResolveWorkflowIssueDto } from './workflow.dto'
import type { WorkflowIssue } from './workflow.contracts'
import { WorkflowStoreService } from './workflow-store.service'
import { WorkflowIssueEvidenceService } from './workflow-issue-evidence.service'
import { ReportSessionStore } from './report-session-store.service'

@Injectable()
export class WorkflowIssuesService {
  constructor(
    private readonly database: DataSource,
    private readonly store: WorkflowStoreService,
    private readonly evidence: WorkflowIssueEvidenceService,
    private readonly sessions:ReportSessionStore,
  ) {}
  async open(id: string, dto: OpenWorkflowIssueDto, context: CompanyAccessContext) {
    this.store.permission(context, 'exams.issues.manage')
    return this.store.run(id, dto.expectedVersion, context, async (exam, manager) => {
      this.store.assertMutable(exam)
      if(await this.sessions.current(id,manager)) throw new ConflictException('Salve e encerre o laudário antes de registrar pendência ou reconvocação.')
      await this.evidence.opening(exam, dto, context, manager)
      const [previous] = await manager.query<Array<{ phase: WorkflowIssue['phase'] }>>(
        'SELECT phase FROM exam_workflow_issues WHERE exam_id=$1 AND resolved_at IS NULL ORDER BY opened_at LIMIT 1',
        [id],
      )
      const phase =
        previous?.phase ??
        (['IN_PROGRESS', 'TYPED'].includes(exam.workflowState) ? 'REPORTING' : 'PREPARATION')
      const issued = await manager.query<WorkflowIssue[]>(
        `INSERT INTO exam_workflow_issues(company_id,unit_id,exam_id,kind,category,reason,requested_action,responsible_user_id,opened_by_user_id,phase,attachment_ids,comment_ids,recall_purpose)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          exam.companyId,
          exam.unitId,
          id,
          dto.kind,
          dto.category,
          this.store.reason(dto.reason),
          dto.requestedAction ?? null,
          dto.responsibleUserId ?? null,
          context.userId,
          phase,
          dto.attachmentIds ?? [],
          dto.commentIds ?? [],
          dto.kind==='RECALL' ? dto.recallPurpose??'CORRECTION' : null,
        ],
      )
      const issue = issued[0]!
      await manager.query('DELETE FROM exam_report_presences WHERE exam_id=$1', [id])
      const state =
        dto.kind === 'RECALL' || exam.workflowState === 'RECALLED' ? 'RECALLED' : 'PENDING'
      const changed = await this.store.change(
        exam,
        state,
        dto.kind === 'RECALL' ? 'EXAM_RECALLED' : 'EXAM_ISSUE_OPENED',
        dto.reason,
        context,
        manager,
        {
          issueId: issue.id,
          responsibleUserId: dto.responsibleUserId ?? null,
          responsibleUnitId: exam.unitId,
          phase: issue.phase,
        },
      )
      return { exam: changed, issue }
    })
  }
  async resolve(
    id: string,
    issueId: string,
    dto: ResolveWorkflowIssueDto,
    context: CompanyAccessContext,
  ) {
    this.store.permission(context, 'exams.issues.manage')
    return this.store.run(id, dto.expectedVersion, context, async (exam, manager) => {
      this.store.assertMutable(exam)
      const [issue] = await manager.query<WorkflowIssue[]>(
        'SELECT * FROM exam_workflow_issues WHERE id=$1 AND exam_id=$2 AND company_id=$3 FOR UPDATE',
        [issueId, id, context.companyId],
      )
      if (!issue) throw new NotFoundException('Pendência/reconvocação não encontrada.')
      if (issue.resolved_at) throw new ConflictException('Solicitação já resolvida.')
      await this.evidence.resolution(exam, issue, dto, context, manager)
      await manager.query(
        `UPDATE exam_workflow_issues SET resolved_at=now(),resolved_by_user_id=$2,resolution_reason=$3,
        resolution_study_ids=$4,resolution_attachment_ids=$5,complement_exam_id=$6 WHERE id=$1`,
        [
          issueId,
          context.userId,
          this.store.reason(dto.reason),
          dto.studyIds ?? [],
          dto.attachmentIds ?? [],
          dto.complementExamId ?? null,
        ],
      )
      const open = await manager.query<Array<{ kind: string }>>(
        'SELECT kind FROM exam_workflow_issues WHERE exam_id=$1 AND resolved_at IS NULL',
        [id],
      )
      const state = open.some((i) => i.kind === 'RECALL')
        ? 'RECALLED'
        : open.length
          ? 'PENDING'
          : 'TO_PREPARE'
      return this.store.change(exam, state, 'EXAM_ISSUE_RESOLVED', dto.reason, context, manager, {
        issueId,
        studyIds: dto.studyIds ?? [],
        attachmentIds: dto.attachmentIds ?? [],
        complementExamId: dto.complementExamId ?? null,
        acquisitionConfirmed: dto.acquisitionConfirmed ?? false,
        slaPaused: false,
      })
    })
  }
}
