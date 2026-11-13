import { Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { ReportVersionAccess } from './report-version-access.service'
import { ReportDeliveryService } from './report-delivery.service'
import type { ReportActivityDto } from './report-lifecycle.contracts'
import { assertRevisionAuthorized } from './report-revision.policy'
import { ForbiddenException } from '@nestjs/common'

@Injectable()
export class ReportHistoryService {
  constructor(private readonly db:DataSource,private readonly access:ReportVersionAccess,private readonly delivery:ReportDeliveryService,private readonly audit:OperationalAuditService){}
  async version(id:string,context:CompanyAccessContext) {
    const row=await this.access.require(id,context)
    await this.audit.record(context,{action:'REPORT_VERSION_ACCESSED',resourceType:'exam',resourceId:row.exam_id,unitId:row.unit_id,metadata:{completionId:id,version:row.version}})
    return this.delivery.document(row)
  }
  async history(id:string,context:CompanyAccessContext) {
    const row=await this.access.require(id,context)
    const central=row.company_id===context.companyId && context.permissions.includes('reports.view')
    const versions=await this.db.query<unknown[]>(`SELECT id,version,physician_user_id AS "physicianUserId",snapshot->'physician' AS physician,
      finalized_at AS "finalizedAt",sent_at AS "sentAt",revision_reason AS reason,content_hash AS "contentHash",previous_version_id AS "previousVersionId"
      FROM exam_report_completions WHERE exam_id=$1 AND ($2::boolean OR (origin_company_id=$3 AND sent_at IS NOT NULL AND ($4::boolean OR origin_unit_id=ANY($5::uuid[])))) ORDER BY version DESC`,
      [row.exam_id,central,context.companyId,context.allUnits,context.unitIds])
    const reviews=await this.db.query<unknown[]>(`SELECT r.id,r.reason,r.status,r.requested_at AS "requestedAt",r.resolution_reason AS "resolutionReason",r.resolved_at AS "resolvedAt",u.full_name AS "requestedByName"
      FROM exam_report_reviews r JOIN auth_users u ON u.id=r.requested_by_user_id WHERE r.exam_id=$1 AND ($2::boolean OR r.requested_company_id=$3) ORDER BY r.requested_at DESC`,[row.exam_id,central,context.companyId])
    const events=central ? await this.db.query<unknown[]>(`SELECT e.id,e.action,e.reason,e.occurred_at AS "occurredAt",u.full_name AS "actorName",e.metadata
      FROM operational_events e JOIN auth_users u ON u.id=e.actor_user_id WHERE e.resource_id=$1 AND e.action LIKE 'REPORT_%'
      ORDER BY e.occurred_at DESC LIMIT 300`,[row.exam_id]) : []
    const [exam]=await this.db.query<Array<{workflow_state:string;workflow_version:number;archived_at:Date|null}>>('SELECT workflow_state,workflow_version,archived_at FROM exams WHERE id=$1',[row.exam_id])
    if(!exam) throw new NotFoundException('Exame não encontrado.')
    const [latest]=await this.db.query<Array<{id:string}>>('SELECT id FROM exam_report_completions WHERE exam_id=$1 ORDER BY version DESC LIMIT 1',[row.exam_id])
    const isLatest=latest?.id===row.id
    let authorizedDoctor=false
    if(central && context.role==='DOCTOR') {
      try {await assertRevisionAuthorized(row,context,this.db.manager);authorizedDoctor=true} catch(error) {if(!(error instanceof ForbiddenException)) throw error}
    }
    const revisable=isLatest && !exam.archived_at && ['SIGNED','RESIGNED','REVIEW','REVALIDATED'].includes(exam.workflow_state)
    return {versions,reviews,events,workflowState:exam.workflow_state,workflowVersion:exam.workflow_version,isLatest,
      canRevise:revisable && authorizedDoctor,canRevalidate:revisable && authorizedDoctor && exam.workflow_state==='REVIEW',
      canRequestReview:revisable && exam.workflow_state!=='REVIEW' && context.permissions.includes('reports.review.request'),
      canAuthorize:central && isLatest && context.permissions.includes('reports.review.authorize')}
  }
  async activity(id:string,dto:ReportActivityDto,context:CompanyAccessContext) {
    const row=await this.access.require(id,context)
    await this.audit.record(context,{action:dto.activity==='PRINT_REQUESTED'?'REPORT_PRINT_REQUESTED':'REPORT_EXPORT_REQUESTED',resourceType:'exam',resourceId:row.exam_id,unitId:row.unit_id,
      metadata:{completionId:id,version:row.version,contentHash:row.content_hash}})
    return {recorded:true}
  }
}
