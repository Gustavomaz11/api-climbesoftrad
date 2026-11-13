import { ConflictException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { DataSource, type EntityManager } from 'typeorm'
import type { ExamEntity } from '../../database/entities/exam.entity'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { ReportSession } from '../exams/report-lifecycle.contracts'
import { WorkflowStoreService } from './workflow-store.service'

@Injectable()
export class ReportSessionStore implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  private expiring:Promise<void>|null=null
  private readonly logger = new Logger(ReportSessionStore.name)
  constructor(private readonly db: DataSource, private readonly workflow: WorkflowStoreService, private readonly audit: OperationalAuditService) {}
  onModuleInit() {
    this.timer = setInterval(() => { void this.expire().catch(() => this.logger.error('Falha ao encerrar sessões expiradas de laudo.')) }, 10000)
    this.timer.unref()
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  async current(id: string, manager: EntityManager = this.db.manager) {
    const [session] = await manager.query<ReportSession[]>('SELECT * FROM exam_report_sessions WHERE exam_id=$1 AND expires_at>now()', [id])
    return session ?? null
  }
  async assertOwner(id: string, context: CompanyAccessContext, clientId: string | undefined, manager: EntityManager) {
    const session = await this.current(id, manager)
    if (!session || session.user_id !== context.userId || session.client_id !== clientId)
      throw new ConflictException('O laudário está bloqueado ou sua sessão de edição terminou. Atualize a página.')
    return session
  }
  async acquire(exam: ExamEntity, context: CompanyAccessContext, clientId: string, manager: EntityManager) {
    const current = await this.current(exam.id, manager)
    if (current && (current.user_id !== context.userId || current.client_id !== clientId))
      throw new ConflictException('Este laudário já está aberto em outro painel.')
    const [session] = await manager.query<ReportSession[]>(`INSERT INTO exam_report_sessions(exam_id,user_id,client_id,expires_at)
      VALUES($1,$2,$3,now()+interval '90 seconds') ON CONFLICT(exam_id) DO UPDATE SET expires_at=EXCLUDED.expires_at
      WHERE exam_report_sessions.user_id=$2 AND exam_report_sessions.client_id=$3 RETURNING *`, [exam.id, context.userId, clientId])
    if (!session) throw new ConflictException('A sessão anterior ainda está sendo encerrada. Atualize a página.')
    if (!current) await this.audit.record(context, {action:'REPORT_PRESENCE_STARTED',resourceType:'exam',resourceId:exam.id,unitId:exam.unitId}, manager)
    return { active:true, releaseRequested:Boolean(session.release_requested_at), releaseReason:session.release_reason }
  }
  async close(exam: ExamEntity, context: CompanyAccessContext, clientId: string, manager: EntityManager) {
    const session = await this.current(exam.id, manager)
    if (!session || session.user_id !== context.userId || session.client_id !== clientId) return {active:false}
    await manager.query('DELETE FROM exam_report_sessions WHERE exam_id=$1', [exam.id])
    await manager.query('DELETE FROM exam_report_presences WHERE exam_id=$1', [exam.id])
    const [draft] = await manager.query<Array<{has_content:boolean}>>('SELECT has_content FROM exam_report_drafts WHERE exam_id=$1', [exam.id])
    if (exam.workflowState === 'IN_PROGRESS') {
      if (!draft?.has_content) await manager.query('UPDATE exams SET reporting_user_id=NULL,reporting_started_at=NULL WHERE id=$1', [exam.id])
      await this.workflow.change(exam, draft?.has_content ? 'TYPED' : 'TO_PREPARE', 'REPORT_PRESENCE_ENDED',
        session.release_requested_at ? 'Conteúdo salvo antes do encerramento solicitado pela administração' : 'Edição encerrada pelo médico', context, manager)
    }
    return {active:false}
  }
  async requestRelease(id: string, reason: string, context: CompanyAccessContext) {
    this.workflow.permission(context, 'reports.session.force')
    return this.db.transaction(async manager => {
      const exam = await this.workflow.exam(id, context, manager, true)
      const session = await this.current(id, manager)
      if (!session) return { awaitingSave:false }
      await manager.query('UPDATE exam_report_sessions SET release_requested_at=now(),release_requested_by=$2,release_reason=$3 WHERE exam_id=$1', [id, context.userId, reason.trim()])
      await this.audit.record(context, {action:'REPORT_FORCE_RELEASE_REQUESTED',resourceType:'exam',resourceId:id,unitId:exam.unitId,reason,metadata:{physicianUserId:session.user_id}}, manager)
      return {awaitingSave:true}
    })
  }
  async expire() {
    if(this.expiring)return this.expiring
    this.expiring=this.expireBatch()
    try{await this.expiring}finally{this.expiring=null}
  }
  private async expireBatch() {
      const rows = await this.db.query<Array<{exam_id:string}>>('SELECT exam_id FROM exam_report_sessions WHERE expires_at<=now() LIMIT 100')
      for (const {exam_id:id} of rows) await this.db.transaction(async manager => {
        const [exam] = await manager.query<Array<{company_id:string;unit_id:string;workflow_state:string;workflow_version:number}>>('SELECT company_id,unit_id,workflow_state,workflow_version FROM exams WHERE id=$1 FOR UPDATE', [id])
        const [session] = await manager.query<ReportSession[]>('SELECT * FROM exam_report_sessions WHERE exam_id=$1 AND expires_at<=now()', [id])
        if (!exam || !session) return
        await manager.query('DELETE FROM exam_report_sessions WHERE exam_id=$1',[id])
        const [draft] = await manager.query<Array<{has_content:boolean}>>('SELECT has_content FROM exam_report_drafts WHERE exam_id=$1', [id])
        if (exam.workflow_state === 'IN_PROGRESS') {
          const next = draft?.has_content ? 'TYPED' : 'TO_PREPARE'
          await manager.query(`UPDATE exams SET workflow_state=$2::varchar,workflow_version=workflow_version+1,
            reporting_user_id=CASE WHEN $2::varchar='TO_PREPARE' THEN NULL ELSE reporting_user_id END,
            reporting_started_at=CASE WHEN $2::varchar='TO_PREPARE' THEN NULL ELSE reporting_started_at END WHERE id=$1`, [id,next])
          await manager.query(`INSERT INTO exam_workflow_history(company_id,exam_id,from_state,to_state,version,action,reason,actor_user_id,origin)
            VALUES($1,$2,$3,$4,$5,'REPORT_SESSION_EXPIRED','Sessão expirada; último conteúdo salvo preservado',$6,'SYSTEM')`, [exam.company_id,id,exam.workflow_state,next,exam.workflow_version+1,session.user_id])
        }
        await this.audit.record({companyId:exam.company_id,userId:session.user_id,sessionId:'',correlationId:randomUUID()},
          {action:'REPORT_SESSION_EXPIRED',resourceType:'exam',resourceId:id,unitId:exam.unit_id},manager)
      })
  }
}
