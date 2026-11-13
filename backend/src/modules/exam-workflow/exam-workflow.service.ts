import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { PreparationChecklistService } from './preparation-checklist.service'
import { transitionRules, type WorkflowAction } from './workflow.contracts'
import type { VersionedWorkflowDto } from './workflow.dto'
import { WorkflowStoreService } from './workflow-store.service'
import { assertHospitalOriginReceived } from '../exams/report-origin.policy'
import { assertReportOwner } from '../exams/report-assignment.policy'
import { assertRevisionAuthorized, reportReason, requireReportingDoctor } from '../exams/report-revision.policy'
import type { CompletedReportRow } from '../exams/report-completion.contracts'
import { ReportSessionStore } from './report-session-store.service'

@Injectable()
export class ExamWorkflowService {
  constructor(
    private readonly database: DataSource,
    private readonly store: WorkflowStoreService,
    private readonly checklist: PreparationChecklistService,
    private readonly sessions: ReportSessionStore,
  ) {}
  async status(id: string, context: CompanyAccessContext) {
    const exam = await this.store.exam(id, context)
    const session=await this.sessions.current(id)
    const [holder]=session ? await this.database.query<Array<{name:string}>>('SELECT full_name AS name FROM auth_users WHERE id=$1',[session.user_id]) : []
    return {
      workflowState: exam.workflowState,
      workflowVersion: exam.workflowVersion,
      archivedAt: exam.archivedAt,
      reportingUserId: exam.reportingUserId,
      reportingStartedAt: exam.reportingStartedAt,
      editingUserId:session?.user_id??null,
      editingUserName:holder?.name??null,
      releaseRequested:Boolean(session?.release_requested_at),
    }
  }
  async get(id: string, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      let exam = await this.store.exam(id, context, manager, true)
      let checklist = await this.checklist.current(exam, manager)
      if (
        exam.preparedAt &&
        ['READY', 'IN_PROGRESS'].includes(exam.workflowState) &&
        !checklist.satisfied
      ) {
        await manager.query('SELECT invalidate_exam_preparation($1,$2,$3)', [
          id,
          'Reavaliação: evidências ou requisitos indisponíveis',
          context.userId,
        ])
        exam = await this.store.exam(id, context, manager)
        checklist = await this.checklist.current(exam, manager)
      }
      const history = await manager.query<unknown[]>(
        'SELECT h.*,u.full_name AS actor_name FROM exam_workflow_history h LEFT JOIN auth_users u ON u.id=h.actor_user_id WHERE h.exam_id=$1 ORDER BY h.version DESC',
        [id],
      )
      const issues = await manager.query<unknown[]>(
        `SELECT i.*,u.full_name AS responsible_name,
        EXTRACT(EPOCH FROM (COALESCE(i.resolved_at,now())-i.opened_at))::int AS elapsed_seconds
        FROM exam_workflow_issues i LEFT JOIN auth_users u ON u.id=i.responsible_user_id WHERE i.exam_id=$1 ORDER BY i.opened_at DESC`,
        [id],
      )
      return { exam, checklist, history, issues }
    })
  }
  async transition(
    id: string,
    action: WorkflowAction,
    dto: VersionedWorkflowDto,
    context: CompanyAccessContext,
  ) {
    const rule = transitionRules[action]
    this.store.permission(context, rule.permission)
    return this.store.run(id, dto.expectedVersion, context, async (exam, manager) => {
      this.store.assertMutable(exam)
      const [completed] = await manager.query<CompletedReportRow[]>('SELECT * FROM exam_report_completions WHERE exam_id=$1 ORDER BY version DESC LIMIT 1', [id])
      const [draft]=await manager.query<Array<{base_completion_id:string|null}>>('SELECT base_completion_id FROM exam_report_drafts WHERE exam_id=$1',[id])
      if (completed && !(action==='START' && draft?.base_completion_id===completed.id)) throw new ConflictException('Laudo assinado: esta ação exige um fluxo de correção.')
      const claimingLegacyReport = action === 'START' && context.role === 'DOCTOR' && exam.workflowState === 'IN_PROGRESS' && !exam.reportingUserId
      if (!rule.from.includes(exam.workflowState) && !claimingLegacyReport)
        throw new ConflictException('Transição operacional inválida.')
      if (action === 'RELEASE')
        await this.checklist.assertComplete(exam, manager)
      if (action === 'START') {
        if(await this.sessions.current(id,manager)) throw new ConflictException('O laudário está aberto. Aguarde o encerramento da sessão.')
        if(context.role==='DOCTOR') await requireReportingDoctor(exam.unitId,context,manager)
        if(completed) await assertRevisionAuthorized(completed,context,manager)
        if(exam.workflowState==='TYPED' && exam.reportingUserId && exam.reportingUserId!==context.userId) reportReason(dto.takeoverReason??'')
        else assertReportOwner(exam, context)
        await assertHospitalOriginReceived(id, manager)
        if (context.role === 'DOCTOR')
          await manager.query(
            'UPDATE exams SET reporting_user_id=$2,reporting_started_at=COALESCE(reporting_started_at,now()) WHERE id=$1',
            [id, context.userId],
          )
      }
      if (action === 'RELEASE')
        await manager.query(
          'UPDATE exams SET prepared_at=now(),prepared_by_user_id=$2 WHERE id=$1',
          [id, context.userId],
        )
      if (action === 'CANCEL' || action === 'REOPEN') {
        if(await this.sessions.current(id,manager)) throw new ConflictException('Encerre a sessão de laudo antes de alterar o fluxo.')
        await manager.query('DELETE FROM exam_report_presences WHERE exam_id=$1', [id])
        await manager.query('UPDATE exams SET reporting_user_id=NULL,reporting_started_at=NULL WHERE id=$1', [id])
      }
      return this.store.change(
        exam,
        rule.to,
        action === 'RELEASE'
          ? 'EXAM_PREPARED'
          : action === 'CANCEL'
            ? 'EXAM_CANCELLED'
            : 'EXAM_WORKFLOW_CHANGED',
        dto.takeoverReason ?? dto.reason,
        context,
        manager,
      )
    })
  }
  async archive(
    id: string,
    archived: boolean,
    dto: VersionedWorkflowDto,
    context: CompanyAccessContext,
  ) {
    this.store.permission(context, 'exams.archive')
    return this.store.run(id, dto.expectedVersion, context, async (exam, manager) => {
      if (Boolean(exam.archivedAt) === archived)
        throw new ConflictException('Exame já está nesta situação de arquivamento.')
      if (archived && exam.workflowState === 'IN_PROGRESS')
        throw new ConflictException(
          'Reabra a preparação ou cancele antes de arquivar um exame em elaboração.',
        )
      await manager.query('UPDATE exams SET archived_at=$2,archived_by_user_id=$3 WHERE id=$1', [
        id,
        archived ? new Date() : null,
        archived ? context.userId : null,
      ])
      await manager.query('DELETE FROM exam_report_presences WHERE exam_id=$1', [id])
      const state = !archived && exam.workflowState === 'READY' ? 'TO_PREPARE' : exam.workflowState
      return this.store.change(
        exam,
        state,
        archived ? 'EXAM_ARCHIVED' : 'EXAM_UNARCHIVED',
        dto.reason,
        context,
        manager,
      )
    })
  }
}
