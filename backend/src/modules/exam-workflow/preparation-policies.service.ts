import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import type { PreparationItem } from './workflow.contracts'
import type { PreparationPolicyDto } from './workflow.dto'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { WorkflowStoreService } from './workflow-store.service'
import type { ExamEntity } from '../../database/entities/exam.entity'

export interface PreparationPolicy {
  id: string
  company_id: string
  unit_id: string
  exam_type_id: string | null
  version: number
  required_items: PreparationItem[]
  active: boolean
}

@Injectable()
export class PreparationPoliciesService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: CompanyScopeService,
    private readonly audit: OperationalAuditService,
    private readonly store: WorkflowStoreService,
  ) {}
  async list(unitId: string, context: CompanyAccessContext) {
    await this.scope.requireUnit(unitId, context)
    return this.database.query<PreparationPolicy[]>(
      'SELECT * FROM preparation_policies WHERE company_id=$1 AND unit_id=$2 ORDER BY created_at DESC',
      [context.companyId, unitId],
    )
  }
  async effective(exam: ExamEntity, manager: EntityManager) {
    const [policy] = await manager.query<PreparationPolicy[]>(
      `SELECT * FROM preparation_policies WHERE company_id=$1 AND unit_id=$2 AND active
      AND (exam_type_id=$3 OR exam_type_id IS NULL) ORDER BY (exam_type_id IS NOT NULL) DESC LIMIT 1`,
      [exam.companyId, exam.unitId, exam.examTypeId],
    )
    return policy ?? null
  }
  async save(dto: PreparationPolicyDto, context: CompanyAccessContext) {
    this.store.permission(context, 'exams.preparation.manage')
    const unit = await this.scope.requireUnit(dto.unitId, context)
    if (!unit.active) throw new BadRequestException('Unidade inativa.')
    return this.database.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify(['preparation', context.companyId, dto.unitId, dto.examTypeId ?? null]),
      ])
      if (dto.examTypeId) {
        const [type] = await manager.query<Array<{ id: string }>>(
          'SELECT id FROM exam_types WHERE id=$1 AND company_id=$2 AND active',
          [dto.examTypeId, context.companyId],
        )
        if (!type) throw new BadRequestException('Tipo de exame inválido ou inativo.')
      }
      const [old] = await manager.query<PreparationPolicy[]>(
        `SELECT * FROM preparation_policies WHERE company_id=$1 AND unit_id=$2 AND exam_type_id IS NOT DISTINCT FROM $3::uuid AND active`,
        [context.companyId, dto.unitId, dto.examTypeId ?? null],
      )
      if ((old?.version ?? 0) !== dto.expectedVersion)
        throw new ConflictException('Requisitos alterados. Atualize a configuração.')
      if (old)
        await manager.query('UPDATE preparation_policies SET active=false WHERE id=$1', [old.id])
      const savedRows = await manager.query<PreparationPolicy[]>(
        `INSERT INTO preparation_policies(company_id,unit_id,exam_type_id,version,required_items,reason,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          context.companyId,
          dto.unitId,
          dto.examTypeId ?? null,
          dto.expectedVersion + 1,
          JSON.stringify(dto.requiredItems),
          this.store.reason(dto.reason),
          context.userId,
        ],
      )
      const saved = savedRows[0]!
      // Lock in a stable order; changing rules requires a new manual conference.
      const exams = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM exams WHERE company_id=$1 AND unit_id=$2 AND ($3::uuid IS NULL OR exam_type_id=$3) ORDER BY id`,
        [context.companyId, dto.unitId, dto.examTypeId ?? null],
      )
      for (const exam of exams)
        await manager.query('SELECT invalidate_exam_preparation($1,$2,$3)', [
          exam.id,
          'Requisitos de preparação alterados: ' + saved.id,
          context.userId,
        ])
      await this.audit.record(
        context,
        {
          action: 'PREPARATION_POLICY_CHANGED',
          resourceType: 'preparation-policy',
          resourceId: saved.id,
          unitId: dto.unitId,
          reason: dto.reason,
          metadata: { version: saved.version, previousId: old?.id ?? null },
        },
        manager,
      )
      return saved
    })
  }
}
