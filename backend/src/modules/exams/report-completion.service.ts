import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { CompanyPresentationService } from '../companies/company-presentation.service'
import { WorkflowStoreService } from '../exam-workflow/workflow-store.service'
import { registeredCrmForState, registryAllowsState, type PhysicianRegistryProfile } from '../physicians/physician-registry.policy'
import { R2ExamReportStorage } from './r2-exam-report-storage.service'
import { completedContent } from './completed-report-document'
import type { ReportNode } from './exam-reports.service'
import type { CompletedReportRow, CompletedSnapshot, FinalizeReportDto } from './report-completion.contracts'
import { ReportDeliveryService } from './report-delivery.service'
import { assertHospitalOriginReceived } from './report-origin.policy'
import type { PhysicianSignatureImage } from '../physicians/physician-signature.contract'

@Injectable()
export class ReportCompletionService {
  constructor(private readonly db: DataSource, private readonly workflow: WorkflowStoreService,
    private readonly storage: R2ExamReportStorage,
    private readonly presentation: CompanyPresentationService, private readonly delivery: ReportDeliveryService) {}

  async finalize(id: string, dto: FinalizeReportDto, context: CompanyAccessContext) {
    this.workflow.permission(context, 'reports.finalize')
    this.workflow.permission(context, 'reports.edit')
    if (context.role !== 'DOCTOR') throw new ForbiddenException('Somente o médico pode finalizar o laudo.')
    const row = await this.db.transaction(async manager => {
      const exam = await this.workflow.exam(id, context, manager, true)
      const [existing] = await manager.query<CompletedReportRow[]>('SELECT * FROM exam_report_completions WHERE exam_id=$1', [id])
      if (existing) {
        if (existing.content_hash !== dto.contentHash || existing.physician_user_id !== context.userId || existing.snapshot.signature?.id !== dto.signatureId)
          throw new ConflictException('O laudo já foi finalizado com outra versão ou médico.')
        return existing
      }
      this.workflow.assertMutable(exam)
      if (exam.workflowVersion !== dto.expectedVersion || exam.workflowState !== 'IN_PROGRESS')
        throw new ConflictException('Inicie a elaboração e atualize o exame antes de finalizar.')
      await assertHospitalOriginReceived(id, manager)
      const [physician] = await manager.query<Array<{ name: string; crm: string; signature_image: PhysicianSignatureImage | null; registry_profile: PhysicianRegistryProfile | null; uf: string | null; unit: string; active: boolean }>>(
        'SELECT p.name,p.crm,p.signature_image,p.registry_profile,u.uf,u.name AS unit,u.active FROM physicians p JOIN hospital_units u ON u.id=$2 WHERE p.user_id=$1 FOR SHARE OF p', [context.userId, exam.unitId])
      if (!physician?.active || !registryAllowsState(physician.registry_profile, physician.uf))
        throw new ForbiddenException('Médico sem cadastro ou inscrição regular para esta unidade.')
      if (!physician.signature_image) throw new ForbiddenException('Cadastre a imagem da sua assinatura antes de finalizar.')
      if (physician.signature_image.id !== dto.signatureId) throw new ConflictException('Sua assinatura foi atualizada. Confira a imagem atual antes de assinar o laudo.')
      const body = await this.storage.read(id)
      const stored = body ? JSON.parse(body) as { content: ReportNode } : null
      if (!stored || createHash('sha256').update(JSON.stringify(stored.content)).digest('hex') !== dto.contentHash)
        throw new ConflictException('O rascunho foi alterado. Salve e confira a versão atual antes de finalizar.')
      const origins = await manager.query<Array<{ company_id: string; unit_id: string; name: string }>>(
        `SELECT DISTINCT i.company_id,i.unit_id,u.name FROM hospital_intakes i JOIN hospital_units u ON u.id=i.unit_id
         WHERE i.exam_id=$1 AND i.status='SUBMITTED' AND i.recipient_company_id=$2 AND i.recipient_unit_id=$3`, [id, exam.companyId, exam.unitId])
      if (origins.length > 1) throw new ConflictException('Mais de um hospital de origem: confira os vínculos do exame.')
      const snapshot: CompletedSnapshot = {
        signature: physician.signature_image,
        evidenceVersion: exam.evidenceVersion,
        content: completedContent(stored.content, id),
        presentation: (await this.presentation.current(context.companyId, exam.unitId, context.userId)).effective,
        exam: { id, companyId: exam.companyId, unitId: exam.unitId, unit: physician.unit, patientName: exam.patientName, birthDate: exam.birthDate, studyDescription: exam.studyDescription, performedAt: exam.performedAt.toISOString(), modality: exam.modality },
        physician: { name: physician.name, crm: registeredCrmForState(physician.registry_profile, physician.uf, physician.crm) },
        originUnitName: origins[0]?.name ?? null,
      }
      const [completed] = await manager.query<CompletedReportRow[]>(`INSERT INTO exam_report_completions(exam_id,company_id,unit_id,physician_user_id,content_hash,snapshot,origin_company_id,origin_unit_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [id, exam.companyId, exam.unitId, context.userId, dto.contentHash, JSON.stringify(snapshot), origins[0]?.company_id ?? null, origins[0]?.unit_id ?? null])
      await manager.query('DELETE FROM exam_report_presences WHERE exam_id=$1', [id])
      await this.workflow.change(exam, 'TYPED', 'REPORT_FINALIZED', 'Laudo assinado com imagem e finalizado pelo médico', context, manager, { completionId: completed!.id, contentHash: dto.contentHash, signatureId: dto.signatureId, signatureSha256: physician.signature_image.sha256 })
      return completed!
    })
    return this.delivery.document(row)
  }
}
