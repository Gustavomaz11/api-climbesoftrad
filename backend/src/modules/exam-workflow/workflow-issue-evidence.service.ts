import { BadRequestException, Injectable } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import type { ExamEntity } from '../../database/entities/exam.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { OpenWorkflowIssueDto, ResolveWorkflowIssueDto } from './workflow.dto'
import type { WorkflowIssue } from './workflow.contracts'
import { PreparationEvidenceService } from './preparation-evidence.service'
import { WorkflowStoreService } from './workflow-store.service'

@Injectable()
export class WorkflowIssueEvidenceService {
  constructor(
    private readonly store: WorkflowStoreService,
    private readonly evidence: PreparationEvidenceService,
  ) {}
  async opening(
    exam: ExamEntity,
    dto: OpenWorkflowIssueDto,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    if (dto.kind === 'RECALL' && !dto.requestedAction)
      throw new BadRequestException('Informe a ação solicitada na reconvocação.')
    if (dto.kind === 'PENDING' && dto.requestedAction)
      throw new BadRequestException('A ação solicitada é específica da reconvocação.')
    if (dto.responsibleUserId) {
      const [user] = await manager.query<Array<{ id: string }>>(
        `SELECT u.id FROM auth_users u WHERE u.id=$1 AND u.status='ACTIVE' AND
        (u.role='ADMIN' OR EXISTS(SELECT 1 FROM company_memberships m JOIN access_roles r ON r.id=m.access_role_id
          JOIN access_role_permissions p ON p.role_id=r.id AND p.permission_code='exams.view'
          WHERE m.user_id=u.id AND m.company_id=$2 AND m.active AND r.active AND (m.all_units OR EXISTS(
            SELECT 1 FROM company_membership_units mu WHERE mu.membership_id=m.id AND mu.unit_id=$3 AND mu.active))))`,
        [dto.responsibleUserId, exam.companyId, exam.unitId],
      )
      if (!user) throw new BadRequestException('Responsável sem vínculo/acesso ativo à unidade.')
    }
    await this.related(exam, 'exam_attachments', dto.attachmentIds ?? [], context, manager)
    await this.related(exam, 'exam_comments', dto.commentIds ?? [], context, manager)
  }
  private async related(
    exam: ExamEntity,
    table: 'exam_attachments' | 'exam_comments',
    ids: string[],
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    if (!ids.length) return
    this.store.permission(
      context,
      table === 'exam_attachments' ? 'attachments.view' : 'comments.view',
    )
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM ${table} WHERE id=ANY($1::uuid[]) AND exam_id=$2 AND company_id=$3`,
      [ids, exam.id, exam.companyId],
    )
    if (rows.length !== ids.length)
      throw new BadRequestException('Anexo/comentário não pertence ao exame.')
  }
  private async complement(
    exam: ExamEntity,
    issue: WorkflowIssue,
    dto: ResolveWorkflowIssueDto,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    let target = exam
    if (dto.complementExamId) {
      target = await this.store.exam(dto.complementExamId, context, manager)
      if (
        target.id === exam.id ||
        target.patientId !== exam.patientId ||
        target.unitId !== exam.unitId ||
        target.examTypeId !== exam.examTypeId ||
        target.modality !== exam.modality ||
        target.createdAt <= issue.opened_at ||
        target.workflowState === 'CANCELLED' ||
        target.archivedAt
      )
        throw new BadRequestException(
          'Complementação deve ser posterior, da mesma unidade, paciente e tipo/modalidade. Não é permitido reutilizar ou fundir exames.',
        )
      // A valid complement is newer than the source; lock it after validating that direction.
      target = await this.store.exam(dto.complementExamId, context, manager, true)
      if (
        target.patientId !== exam.patientId ||
        target.unitId !== exam.unitId ||
        target.examTypeId !== exam.examTypeId ||
        target.modality !== exam.modality ||
        target.workflowState === 'CANCELLED' ||
        target.archivedAt
      )
        throw new BadRequestException('A complementação foi alterada. Atualize a revisão.')
    }
    return target
  }
  async resolution(
    exam: ExamEntity,
    issue: WorkflowIssue,
    dto: ResolveWorkflowIssueDto,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    const target = await this.complement(exam, issue, dto, context, manager)
    const attachments = dto.attachmentIds ?? [],
      studies = dto.studyIds ?? []
    const available = await this.evidence.collect(target, manager)
    if (studies.length && !available.find((item) => item.item === 'IMAGES')?.available)
      throw new BadRequestException('Imagens indisponíveis ou recepção ainda incompleta.')
    const approvedIds = new Set(
      available.filter((item) => item.item !== 'IMAGES').flatMap((item) => item.evidenceIds),
    )
    const documents = attachments.length
      ? await manager.query<Array<{ id: string; created_at: Date }>>(
          `SELECT id,created_at FROM exam_attachments WHERE id=ANY($1::uuid[]) AND exam_id=$2 AND company_id=$3`,
          [attachments, target.id, exam.companyId],
        )
      : []
    if (documents.length !== attachments.length || documents.some((d) => !approvedIds.has(d.id)))
      throw new BadRequestException(
        'Selecione anexos atuais aprovados e disponíveis do exame/complementação.',
      )
    const images = studies.length
      ? await manager.query<
          Array<{
            id: string
            created_at: Date
            completed_at: Date | null
            instances: number
            new_instances: number
          }>
        >(
          `SELECT s.id,s.created_at,s.completed_at,COUNT(i.id)::int AS instances,
      COUNT(i.id) FILTER(WHERE i.created_at>$4)::int AS new_instances FROM dicom_studies s LEFT JOIN dicom_instances i ON i.study_id=s.id
      WHERE s.id=ANY($1::uuid[]) AND s.exam_id=$2 AND s.company_id=$3 GROUP BY s.id`,
          [studies, target.id, exam.companyId, issue.opened_at],
        )
      : []
    if (images.length !== studies.length || images.some((s) => !s.completed_at || !s.instances))
      throw new BadRequestException(
        'Selecione estudos recebidos e conferidos do exame/complementação.',
      )
    if (issue.kind === 'RECALL') {
      if (issue.requested_action === 'ACQUISITION' && dto.acquisitionConfirmed !== true)
        throw new BadRequestException(
          'Confirme manualmente que a evidência corresponde à nova aquisição solicitada; chegada tardia isolada não comprova isso.',
        )
      if (issue.requested_action === 'ACQUISITION' && !images.some((s) => s.new_instances > 0))
        throw new BadRequestException(
          'A reconvocação exige instâncias novas recebidas após sua abertura. Reenvio não resolve nova aquisição.',
        )
      if (
        issue.requested_action === 'DOCUMENTS' &&
        !documents.some((d) => d.created_at > issue.opened_at)
      )
        throw new BadRequestException(
          'A reconvocação documental exige um anexo novo aprovado após sua abertura.',
        )
    }
    if (dto.complementExamId && !attachments.length && !studies.length)
      throw new BadRequestException('Indique a evidência da complementação.')
  }
}
