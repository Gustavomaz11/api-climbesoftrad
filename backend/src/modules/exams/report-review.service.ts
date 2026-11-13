import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { ExamEntity } from '../../database/entities/exam.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { WorkflowStoreService } from '../exam-workflow/workflow-store.service'
import { ReportSessionStore } from '../exam-workflow/report-session-store.service'
import { assertRevisionAuthorized, reportReason } from './report-revision.policy'
import { reportContentHash } from './report-draft-store.service'
import { ReportVersionAccess } from './report-version-access.service'
import type { CompletedReportRow } from './report-completion.contracts'
import type { ReportAuthorizationDto, ReportRevisionDto } from './report-lifecycle.contracts'

@Injectable()
export class ReportReviewService {
  constructor(private readonly db:DataSource,private readonly workflow:WorkflowStoreService,private readonly sessions:ReportSessionStore,
    private readonly access:ReportVersionAccess,private readonly audit:OperationalAuditService){}
  async request(completionId:string,reason:string,context:CompanyAccessContext) {
    this.workflow.permission(context,'reports.review.request')
    reason=reportReason(reason)
    return this.db.transaction(async manager=>{
      const base=await this.access.require(completionId,context,manager)
      const exam=await manager.getRepository(ExamEntity).findOne({where:{id:base.exam_id},lock:{mode:'pessimistic_write'}})
      if(!exam || exam.archivedAt || !['SIGNED','RESIGNED','REVALIDATED'].includes(exam.workflowState)) throw new ConflictException('Este laudo já está em revisão ou não está disponível para reavaliação.')
      const [latest]=await manager.query<CompletedReportRow[]>('SELECT * FROM exam_report_completions WHERE exam_id=$1 ORDER BY version DESC LIMIT 1',[exam.id])
      if(latest?.id!==base.id) throw new ConflictException('Existe uma versão mais recente deste laudo.')
      const [review]=await manager.query<Array<{id:string}>>(`INSERT INTO exam_report_reviews(exam_id,base_completion_id,reason,requested_by_user_id,requested_company_id)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[exam.id,base.id,reason,context.userId,context.companyId])
      await this.workflow.change(exam,'REVIEW','REPORT_REVIEW_REQUESTED',reason,{...context,companyId:exam.companyId},manager,{reviewId:review!.id,requestedCompanyId:context.companyId,completionId:base.id})
      return {id:review!.id}
    })
  }
  async authorize(id:string,dto:ReportAuthorizationDto,context:CompanyAccessContext) {
    this.workflow.permission(context,'reports.review.authorize')
    const reason=reportReason(dto.reason)
    return this.db.transaction(async manager=>{
      const exam=await this.workflow.exam(id,context,manager,true)
      const [base]=await manager.query<CompletedReportRow[]>('SELECT * FROM exam_report_completions WHERE exam_id=$1 ORDER BY version DESC LIMIT 1',[id])
      if(!base || base.id!==dto.completionId) throw new ConflictException('Selecione a versão atual do laudo.')
      const [doctor]=await manager.query<Array<{id:string}>>(`SELECT u.id FROM auth_users u JOIN physicians p ON p.user_id=u.id
        JOIN company_memberships m ON m.user_id=u.id AND m.company_id=$2 AND m.active
        JOIN access_roles r ON r.id=m.access_role_id AND r.active
        WHERE u.id=$1 AND u.role='DOCTOR' AND u.status='ACTIVE' AND
          (m.all_units OR EXISTS(SELECT 1 FROM company_membership_units mu WHERE mu.membership_id=m.id AND mu.unit_id=$3 AND mu.active))
          AND EXISTS(SELECT 1 FROM access_role_permissions rp WHERE rp.role_id=r.id AND rp.permission_code='reports.finalize')`,[dto.physicianUserId,exam.companyId,exam.unitId])
      if(!doctor) throw new NotFoundException('Médico sem acesso ativo a esta unidade.')
      const [grant]=await manager.query<Array<{id:string}>>(`INSERT INTO exam_report_authorizations(base_completion_id,physician_user_id,authorized_by_user_id,reason)
        VALUES($1,$2,$3,$4) ON CONFLICT(base_completion_id,physician_user_id) DO UPDATE SET authorized_by_user_id=EXCLUDED.authorized_by_user_id,reason=EXCLUDED.reason RETURNING id`,[base.id,dto.physicianUserId,context.userId,reason])
      await this.audit.record(context,{action:'REPORT_REASSIGN_AUTHORIZED',resourceType:'exam',resourceId:id,unitId:exam.unitId,reason,metadata:{completionId:base.id,physicianUserId:dto.physicianUserId,authorizationId:grant!.id}},manager)
      return {id:grant!.id}
    })
  }
  async begin(id:string,dto:ReportRevisionDto,context:CompanyAccessContext) {
    const reason=reportReason(dto.reason)
    return this.workflow.run(id,dto.expectedVersion,context,async(exam,manager)=>{
      const [base]=await manager.query<CompletedReportRow[]>('SELECT * FROM exam_report_completions WHERE exam_id=$1 ORDER BY version DESC LIMIT 1',[id])
      if(!base || base.id!==dto.completionId || exam.archivedAt) throw new ConflictException('Confira a versão atual do laudo antes de corrigir.')
      if(!['SIGNED','RESIGNED','REVIEW','REVALIDATED'].includes(exam.workflowState) || await this.sessions.current(id,manager)) throw new ConflictException('O laudário já está aberto ou indisponível para correção.')
      await assertRevisionAuthorized(base,context,manager)
      await manager.query(`INSERT INTO exam_report_drafts(exam_id,content,content_hash,has_content,updated_by_user_id,base_completion_id,revision_reason)
        VALUES($1,$2,$3,true,$4,$5,$6) ON CONFLICT(exam_id) DO UPDATE SET content=EXCLUDED.content,content_hash=EXCLUDED.content_hash,
        has_content=true,updated_at=now(),updated_by_user_id=EXCLUDED.updated_by_user_id,base_completion_id=$5,revision_reason=$6`,
        [id,JSON.stringify(base.snapshot.content),reportContentHash(base.snapshot.content),context.userId,base.id,reason])
      await manager.query('UPDATE exams SET reporting_user_id=$2,reporting_started_at=now() WHERE id=$1',[id,context.userId])
      await manager.query("UPDATE exam_report_reviews SET status='IN_PROGRESS' WHERE exam_id=$1 AND resolved_at IS NULL",[id])
      return this.workflow.change(exam,'IN_PROGRESS','REPORT_REVISION_STARTED',reason,context,manager,{previousVersionId:base.id,previousPhysicianUserId:base.physician_user_id})
    })
  }
  async revalidate(id:string,dto:ReportRevisionDto,context:CompanyAccessContext) {
    const reason=reportReason(dto.reason)
    return this.workflow.run(id,dto.expectedVersion,context,async(exam,manager)=>{
      const [base]=await manager.query<CompletedReportRow[]>('SELECT * FROM exam_report_completions WHERE exam_id=$1 ORDER BY version DESC LIMIT 1',[id])
      if(!base || base.id!==dto.completionId || exam.workflowState!=='REVIEW' || exam.archivedAt) throw new ConflictException('Não há reavaliação pendente desta versão.')
      await assertRevisionAuthorized(base,context,manager)
      const reviews=await manager.query<Array<{id:string}>>(`WITH resolved AS (UPDATE exam_report_reviews SET status='REVALIDATED',resolved_at=now(),resolved_by_user_id=$2,
        resolution_reason=$3,resulting_completion_id=$4 WHERE exam_id=$1 AND resolved_at IS NULL RETURNING id) SELECT id FROM resolved`,[id,context.userId,reason,base.id])
      if(!reviews.length) throw new ConflictException('Solicitação já resolvida.')
      await this.workflow.change(exam,'REVALIDATED','REPORT_REVALIDATED',reason,context,manager,{completionId:base.id})
      return {completionId:base.id}
    })
  }
}
