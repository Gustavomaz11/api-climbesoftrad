import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource, In, type EntityManager } from 'typeorm'
import { ExamEntity } from '../../database/entities/exam.entity'
import type { OperationalAction } from '../../database/entities/operational-event.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { PermissionCode } from '../access-control/permission.catalog'
import type { WorkflowState } from './workflow.contracts'
import { assertExamOperationallyWritable } from './workflow-mutation-policy'
import { registryAllowsState, type PhysicianRegistryProfile } from '../physicians/physician-registry.policy'

@Injectable()
export class WorkflowStoreService {
  constructor(
    private readonly database: DataSource,
    private readonly audit: OperationalAuditService,
  ) {}

  permission(context: CompanyAccessContext, permission: PermissionCode) {
    if (!context.permissions.includes(permission))
      throw new ForbiddenException('Sem permissão para esta ação operacional.')
  }
  async exam(
    id: string,
    context: CompanyAccessContext,
    manager = this.database.manager,
    lock = false,
  ) {
    const exam = await manager.getRepository(ExamEntity).findOne({
      where: {
        id,
        companyId: context.companyId,
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    })
    if (!exam) throw new NotFoundException('Exame não encontrado.')
    return exam
  }
  async run<T>(
    id: string,
    expectedVersion: number,
    context: CompanyAccessContext,
    operation: (exam: ExamEntity, manager: EntityManager) => Promise<T>,
  ) {
    return this.database.transaction(async (manager) => {
      const exam = await this.exam(id, context, manager, true)
      if (exam.workflowVersion !== expectedVersion)
        throw new ConflictException(
          'O exame foi alterado. Atualize a preparação antes de tentar novamente.',
        )
      const [unit] = await manager.query<Array<{ active: boolean }>>(
        'SELECT active FROM hospital_units WHERE id=$1 AND company_id=$2',
        [exam.unitId, exam.companyId],
      )
      if (!unit?.active)
        throw new ConflictException('Unidade inativa: apenas consulta histórica disponível.')
      return operation(exam, manager)
    })
  }
  assertMutable(exam: ExamEntity) {
    assertExamOperationallyWritable(exam)
  }
  reason(value: string) {
    if (value.trim().length < 3)
      throw new BadRequestException('Informe uma justificativa com ao menos três caracteres.')
    return value.trim()
  }
  async change(
    exam: ExamEntity,
    state: WorkflowState,
    action: OperationalAction,
    reason: string,
    context: CompanyAccessContext,
    manager: EntityManager,
    metadata: Record<string, unknown> = {},
  ) {
    const version = exam.workflowVersion + 1
    await manager.query(
      `UPDATE exams SET workflow_state=$2::varchar,workflow_version=$3,
      prepared_at=CASE WHEN $2::varchar IN ('READY','IN_PROGRESS') THEN prepared_at ELSE NULL END,
      prepared_by_user_id=CASE WHEN $2::varchar IN ('READY','IN_PROGRESS') THEN prepared_by_user_id ELSE NULL END,
      updated_at=now() WHERE id=$1`,
      [exam.id, state, version],
    )
    await manager.query(
      `INSERT INTO exam_workflow_history(company_id,exam_id,from_state,to_state,version,action,reason,actor_user_id,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        exam.companyId,
        exam.id,
        exam.workflowState,
        state,
        version,
        action,
        this.reason(reason),
        context.userId,
        JSON.stringify({ ...metadata, previousPreparedAt: exam.preparedAt }),
      ],
    )
    await this.audit.record(
      context,
      {
        action,
        resourceType: 'exam',
        resourceId: exam.id,
        unitId: exam.unitId,
        reason: this.reason(reason),
        metadata: { from: exam.workflowState, to: state, version },
      },
      manager,
    )
    return this.exam(exam.id, context, manager)
  }
  // Serialize clinical writes with cancellation, including writes to object storage.
  async writable<T>(
    id: string,
    context: CompanyAccessContext,
    operation: (exam: ExamEntity, manager: EntityManager) => Promise<T>,
  ) {
    return this.database.transaction(async (manager) => {
      const exam = await this.exam(id, context, manager, true)
      this.assertMutable(exam)
      if (context.role === 'DOCTOR') {
        const [registration] = await manager.query<Array<{ registry_profile: PhysicianRegistryProfile | null; uf: string | null }>>(
          `SELECT p.registry_profile,u.uf FROM physicians p JOIN hospital_units u ON u.id=$2 WHERE p.user_id=$1`, [context.userId, exam.unitId],
        )
        if (registration && !registryAllowsState(registration.registry_profile, registration.uf))
          throw new ForbiddenException('Médico sem inscrição regular para o estado desta unidade.')
      }
      return operation(exam, manager)
    })
  }
}
