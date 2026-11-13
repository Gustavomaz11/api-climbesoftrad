import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { CompanyPresentationService } from '../companies/company-presentation.service'
import { WorkflowStoreService } from '../exam-workflow/workflow-store.service'
import { registeredCrmForState, registryAllowsState, type PhysicianRegistryProfile } from '../physicians/physician-registry.policy'
import { completedContent } from './completed-report-document'
import type { CompletedReportRow, CompletedSnapshot, FinalizeReportDto } from './report-completion.contracts'
import { ReportDeliveryService } from './report-delivery.service'
import { assertHospitalOriginReceived } from './report-origin.policy'
import { assertReportEditing } from './report-assignment.policy'
import { ReportDraftStore, reportContentHash } from './report-draft-store.service'
import { ReportSessionStore } from '../exam-workflow/report-session-store.service'
import { assertRevisionAuthorized, reportReason } from './report-revision.policy'
import type { PhysicianSignatureImage } from '../physicians/physician-signature.contract'

@Injectable()
export class ReportCompletionService {
  constructor(private readonly db: DataSource, private readonly workflow: WorkflowStoreService,
    private readonly drafts: ReportDraftStore, private readonly sessions:ReportSessionStore,
    private readonly presentation: CompanyPresentationService, private readonly delivery: ReportDeliveryService) {}

  async finalize(id: string, dto: FinalizeReportDto, context: CompanyAccessContext) {
    this.workflow.permission(context, 'reports.finalize')
    this.workflow.permission(context, 'reports.edit')
    if (context.role !== 'DOCTOR') throw new ForbiddenException('Somente o médico pode finalizar o laudo.')
    const row = await this.db.transaction(async manager => {
      const exam = await this.workflow.exam(id, context, manager, true)
      const [existing] = await manager.query<CompletedReportRow[]>('SELECT * FROM exam_report_completions WHERE exam_id=$1 ORDER BY version DESC LIMIT 1', [id])
      const draft=await this.drafts.get(id,context,manager)
      const revising=Boolean(existing && draft.base_completion_id===existing.id && exam.workflowState==='IN_PROGRESS')
      if (existing && !revising) {
        if ((existing.draft_hash??existing.content_hash) !== dto.contentHash || existing.physician_user_id !== context.userId || existing.snapshot.signature?.id !== dto.signatureId)
          throw new ConflictException('O laudo já foi finalizado com outra versão ou médico.')
        return existing
      }
      this.workflow.assertMutable(exam)
      assertReportEditing(exam, context)
      await this.sessions.assertOwner(id,context,dto.clientId,manager)
      if(existing) await assertRevisionAuthorized(existing,context,manager)
      if (exam.workflowVersion !== dto.expectedVersion || exam.workflowState !== 'IN_PROGRESS')
        throw new ConflictException('Inicie a elaboração e atualize o exame antes de finalizar.')
      await assertHospitalOriginReceived(id, manager)
      const [physician] = await manager.query<Array<{ name: string; crm: string; signature_image: PhysicianSignatureImage | null; registry_profile: PhysicianRegistryProfile | null; uf: string | null; unit: string; active: boolean }>>(
        'SELECT p.name,p.crm,p.signature_image,p.registry_profile,u.uf,u.name AS unit,u.active FROM physicians p JOIN hospital_units u ON u.id=$2 WHERE p.user_id=$1 FOR SHARE OF p', [context.userId, exam.unitId])
      if (!physician?.active || !registryAllowsState(physician.registry_profile, physician.uf))
        throw new ForbiddenException('Médico sem cadastro ou inscrição regular para esta unidade.')
      if (!physician.signature_image) throw new ForbiddenException('Cadastre a imagem da sua assinatura antes de finalizar.')
      if (physician.signature_image.id !== dto.signatureId) throw new ConflictException('Sua assinatura foi atualizada. Confira a imagem atual antes de assinar o laudo.')
      if (draft.content_hash !== dto.contentHash)
        throw new ConflictException('O rascunho foi alterado. Salve e confira a versão atual antes de finalizar.')
      const origins = await manager.query<Array<{ company_id: string; unit_id: string; name: string }>>(
        `SELECT DISTINCT i.company_id,i.unit_id,u.name FROM hospital_intakes i JOIN hospital_units u ON u.id=i.unit_id
         WHERE i.exam_id=$1 AND i.status='SUBMITTED' AND i.recipient_company_id=$2 AND i.recipient_unit_id=$3`, [id, exam.companyId, exam.unitId])
      if (origins.length > 1) throw new ConflictException('Mais de um hospital de origem: confira os vínculos do exame.')
      const version=(existing?.version??0)+1
      const revisionReason=existing ? reportReason(draft.revision_reason??'') : null
      const snapshot: CompletedSnapshot = {
        signature: physician.signature_image,
        evidenceVersion: exam.evidenceVersion,
        content: completedContent(draft.content, id),
        presentation: (await this.presentation.current(context.companyId, exam.unitId, context.userId)).effective,
        exam: { id, companyId: exam.companyId, unitId: exam.unitId, unit: physician.unit, patientName: exam.patientName, birthDate: exam.birthDate, studyDescription: exam.studyDescription, performedAt: exam.performedAt.toISOString(), modality: exam.modality },
        physician: { name: physician.name, crm: registeredCrmForState(physician.registry_profile, physician.uf, physician.crm) },
        originUnitName: origins[0]?.name ?? null,
        previousVersionId:existing?.id??null,
        revisionReason,
      }
      const contentHash=reportContentHash(snapshot.content)
      const [completed] = await manager.query<CompletedReportRow[]>(`INSERT INTO exam_report_completions(exam_id,company_id,unit_id,physician_user_id,content_hash,snapshot,origin_company_id,origin_unit_id,version,previous_version_id,revision_reason,draft_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [id, exam.companyId, exam.unitId, context.userId,contentHash, JSON.stringify(snapshot), origins[0]?.company_id ?? null, origins[0]?.unit_id ?? null,version,existing?.id??null,revisionReason,dto.contentHash])
      await manager.query('DELETE FROM exam_report_presences WHERE exam_id=$1', [id])
      await manager.query('DELETE FROM exam_report_sessions WHERE exam_id=$1',[id])
      await manager.query(`UPDATE exam_report_reviews SET status='RESIGNED',resolved_at=now(),resolved_by_user_id=$2,resolution_reason=$3,resulting_completion_id=$4
        WHERE exam_id=$1 AND resolved_at IS NULL`,[id,context.userId,revisionReason??'Laudo assinado',completed!.id])
      await this.workflow.change(exam, existing?'RESIGNED':'SIGNED', existing?'REPORT_RESIGNED':'REPORT_FINALIZED', revisionReason??'Laudo assinado com imagem e finalizado pelo médico', context, manager, { completionId: completed!.id, contentHash, signatureId: dto.signatureId, signatureSha256: physician.signature_image.sha256,version,previousVersionId:existing?.id??null })
      return completed!
    })
    return this.delivery.document(row)
  }
}
