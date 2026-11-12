import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { WorkflowStoreService } from '../exam-workflow/workflow-store.service'
import { R2ExamReportStorage } from './r2-exam-report-storage.service'
import { hydrateCompletedContent } from './completed-report-document'
import type { CompletedReportRow, SendReportDto } from './report-completion.contracts'
import { assertHospitalOriginReceived } from './report-origin.policy'

@Injectable()
export class ReportDeliveryService {
  constructor(private readonly db: DataSource, private readonly workflow: WorkflowStoreService,
    private readonly audit: OperationalAuditService, private readonly storage: R2ExamReportStorage) {}
  async document(row: CompletedReportRow) {
    return { ...row.snapshot, content: await hydrateCompletedContent(row.snapshot.content, this.storage), id: row.id,
      examId: row.exam_id, finalizedAt: row.finalized_at, sentAt: row.sent_at, version: 1, digitallySigned: false }
  }
  async get(id: string, context: CompanyAccessContext) {
    this.workflow.permission(context, 'reports.view')
    await this.workflow.exam(id, context)
    const [row] = await this.db.query<CompletedReportRow[]>('SELECT * FROM exam_report_completions WHERE exam_id=$1', [id])
    return row ? this.document(row) : { completion: null }
  }
  async send(id: string, dto: SendReportDto, context: CompanyAccessContext) {
    this.workflow.permission(context, 'reports.deliver')
    const row = await this.db.transaction(async manager => {
      const exam = await this.workflow.exam(id, context, manager, true)
      const [completed] = await manager.query<CompletedReportRow[]>('SELECT * FROM exam_report_completions WHERE exam_id=$1 AND id=$2 FOR UPDATE', [id, dto.completionId])
      if (!completed) throw new ConflictException('Finalize o laudo antes de enviá-lo ao hospital.')
      if (completed.sent_at) return completed
      if (!completed.snapshot.signature) throw new ConflictException('O laudo precisa da assinatura em imagem do médico antes do envio.')
      if (exam.workflowState !== 'TYPED' || exam.archivedAt) throw new ConflictException('O exame não está disponível para envio.')
      if (exam.evidenceVersion !== completed.snapshot.evidenceVersion) throw new ConflictException('As evidências do exame mudaram após a finalização. Solicite revisão antes do envio.')
      if (!completed.origin_unit_id) throw new ConflictException('O exame não possui hospital de origem vinculado ao envio.')
      const [units] = await manager.query<Array<{ active: boolean }>>('SELECT bool_and(active) AS active FROM hospital_units WHERE id=ANY($1::uuid[])', [[exam.unitId, completed.origin_unit_id]])
      if (!units?.active) throw new ConflictException('Hospital inativo: envio indisponível.')
      await assertHospitalOriginReceived(id, manager)
      const [sent] = await manager.query<CompletedReportRow[]>('UPDATE exam_report_completions SET sent_at=now(),sent_by_user_id=$2 WHERE id=$1 RETURNING *', [completed.id, context.userId])
      await this.audit.record(context, { action: 'REPORT_DELIVERED', resourceType: 'exam', resourceId: id, unitId: exam.unitId,
        metadata: { completionId: completed.id, originUnitId: completed.origin_unit_id, contentHash: completed.content_hash } }, manager)
      return sent!
    })
    return { id: row.id, sentAt: row.sent_at }
  }
  async listHospital(context: CompanyAccessContext) {
    this.workflow.permission(context, 'hospital.results.view')
    const rows = await this.db.query<CompletedReportRow[]>(`SELECT * FROM exam_report_completions WHERE origin_company_id=$1 AND sent_at IS NOT NULL
      AND ($2::boolean OR origin_unit_id=ANY($3::uuid[])) ORDER BY sent_at DESC LIMIT 200`, [context.companyId, context.allUnits, context.unitIds])
    return rows.map(row => ({ id: row.id, examId: row.exam_id, exam: row.snapshot.exam, physician: row.snapshot.physician,
      originUnitId: row.origin_unit_id, originUnitName: row.snapshot.originUnitName, finalizedAt: row.finalized_at, sentAt: row.sent_at }))
  }
  async hospitalDocument(id: string, context: CompanyAccessContext) {
    this.workflow.permission(context, 'hospital.results.view')
    const [row] = await this.db.query<CompletedReportRow[]>(`SELECT * FROM exam_report_completions WHERE id=$1 AND origin_company_id=$2 AND sent_at IS NOT NULL
      AND ($3::boolean OR origin_unit_id=ANY($4::uuid[]))`, [id, context.companyId, context.allUnits, context.unitIds])
    if (!row) throw new NotFoundException('Laudo não encontrado.')
    await this.audit.record(context, { action: 'HOSPITAL_RESULT_ACCESSED', resourceType: 'report', resourceId: row.id, unitId: row.origin_unit_id,
      metadata: { examId: row.exam_id } })
    return this.document(row)
  }
}
