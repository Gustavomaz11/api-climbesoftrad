import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import type { ExamEntity } from '../../database/entities/exam.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { PreparationPoliciesService } from './preparation-policies.service'
import { PreparationEvidenceService } from './preparation-evidence.service'
import { checklistSatisfied, type PreparationItem } from './workflow.contracts'
import type { PreparationCheckDto } from './workflow.dto'
import { WorkflowStoreService } from './workflow-store.service'

@Injectable()
export class PreparationChecklistService {
  constructor(
    private readonly database: DataSource,
    private readonly policies: PreparationPoliciesService,
    private readonly evidence: PreparationEvidenceService,
    private readonly store: WorkflowStoreService,
  ) {}
  async current(exam: ExamEntity, manager: EntityManager = this.database.manager) {
    const policy = await this.policies.effective(exam, manager)
    const items = await this.evidence.collect(exam, manager)
    const checks = policy
      ? await manager.query<
          Array<{
            item: PreparationItem
            confirmed: boolean
            exception_reason: string | null
            checked_by_user_id: string
            checked_at: Date
          }>
        >(
          `SELECT * FROM preparation_checks WHERE exam_id=$1 AND policy_id=$2 AND evidence_version=$3`,
          [exam.id, policy.id, exam.evidenceVersion],
        )
      : []
    const required = items
      .filter((item) => policy?.required_items.includes(item.item))
      .map((item) => {
        const check = checks.find((check) => check.item === item.item)
        return {
          ...item,
          confirmed: check?.confirmed ?? false,
          exceptionReason: check?.exception_reason ?? null,
          checkedByUserId: check?.checked_by_user_id ?? null,
          checkedAt: check?.checked_at ?? null,
        }
      })
    const [issues] = await manager.query<Array<{ count: number }>>(
      'SELECT COUNT(*)::int AS count FROM exam_workflow_issues WHERE exam_id=$1 AND resolved_at IS NULL',
      [exam.id],
    )
    const blockers: string[] = []
    if (!policy) blockers.push('Cadastre os requisitos de preparação da unidade/tipo de exame.')
    if (exam.normalizationStatus !== 'APPROVED')
      blockers.push('Conclua a classificação canônica do exame.')
    const [type] = await manager.query<Array<{ active: boolean; modality: string }>>(
      'SELECT active,modality FROM exam_types WHERE id=$1 AND company_id=$2',
      [exam.examTypeId, exam.companyId],
    )
    if (!type?.active || type.modality !== exam.modality)
      blockers.push('O tipo canônico precisa estar ativo e ser compatível com a modalidade.')
    if (['SUGGESTION', 'CONFLICT'].includes(exam.patientIdentityStatus))
      blockers.push('Conclua a conferência da identidade do paciente.')
    if (issues?.count) blockers.push('Resolva as pendências e reconvocações abertas.')
    if (!checklistSatisfied(required))
      blockers.push('Confira os requisitos ou registre exceções autorizadas.')
    return { policy, items: required, blockers, satisfied: blockers.length === 0 }
  }
  async assertComplete(exam: ExamEntity, manager: EntityManager) {
    const checklist = await this.current(exam, manager)
    if (!checklist.satisfied) throw new ConflictException(checklist.blockers.join(' '))
    return checklist
  }
  async check(id: string, dto: PreparationCheckDto, context: CompanyAccessContext) {
    this.store.permission(context, 'exams.prepare')
    return this.store.run(id, dto.expectedVersion, context, async (exam, manager) => {
      this.store.assertMutable(exam)
      if (!['TO_PREPARE', 'PENDING', 'RECALLED'].includes(exam.workflowState))
        throw new ConflictException('Reabra a preparação antes de alterar a conferência.')
      const policy = await this.policies.effective(exam, manager)
      if (!policy) throw new ConflictException('Cadastre os requisitos de preparação.')
      if (new Set(dto.items.map((i) => i.item)).size !== dto.items.length)
        throw new BadRequestException('Requisito repetido.')
      const evidence = await this.evidence.collect(exam, manager)
      for (const item of dto.items) {
        if (!policy.required_items.includes(item.item))
          throw new BadRequestException('Requisito fora da regra de preparação.')
        if (item.exceptionReason !== undefined) {
          this.store.permission(context, 'exams.preparation.exception')
          this.store.reason(item.exceptionReason)
        }
        const current = evidence.find((e) => e.item === item.item)!
        if (item.item === 'COMPARATIVE' && item.confirmed && !item.exceptionReason) {
          const [accessible] = await manager.query<Array<{ available: boolean }>>(
            `SELECT EXISTS(
            SELECT 1 FROM exam_attachments WHERE id=ANY($1::uuid[]) AND exam_id=$2 AND category='COMPARATIVE'
            UNION ALL SELECT 1 FROM exam_comparatives c JOIN exams prior ON prior.id=c.comparative_exam_id
            WHERE c.id=ANY($1::uuid[]) AND c.exam_id=$2 AND c.active AND ($3 OR prior.unit_id=ANY($4::uuid[]))) AS available`,
            [current.evidenceIds, exam.id, context.allUnits, context.unitIds],
          )
          if (!accessible?.available)
            throw new ConflictException(
              'Comparativo sem evidência acessível ao conferente. Solicite conferência autorizada ou uma exceção justificada.',
            )
        }
        if (item.confirmed && !current.available && !item.exceptionReason?.trim())
          throw new ConflictException('Requisito indisponível exige exceção autorizada.')
        await manager.query(
          `INSERT INTO preparation_checks(company_id,exam_id,policy_id,evidence_version,item,confirmed,exception_reason,evidence_ids,checked_by_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(exam_id,policy_id,evidence_version,item) DO UPDATE SET
          confirmed=EXCLUDED.confirmed,exception_reason=EXCLUDED.exception_reason,evidence_ids=EXCLUDED.evidence_ids,checked_by_user_id=EXCLUDED.checked_by_user_id,checked_at=now()`,
          [
            exam.companyId,
            exam.id,
            policy.id,
            exam.evidenceVersion,
            item.item,
            item.confirmed,
            item.exceptionReason?.trim() ?? null,
            current.evidenceIds,
            context.userId,
          ],
        )
      }
      return this.store.change(
        exam,
        exam.workflowState,
        'PREPARATION_CHECKED',
        dto.reason,
        context,
        manager,
        { policyId: policy.id, evidenceVersion: exam.evidenceVersion, checks: dto.items },
      )
    })
  }
}
