import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { WorkflowStoreService } from './workflow-store.service'
import type { OperationalFieldsDto, PriorityChangeDto } from './workflow.dto'

@Injectable()
export class WorkflowFieldsService {
  constructor(private readonly store: WorkflowStoreService) {}
  async fields(id: string, dto: OperationalFieldsDto, context: CompanyAccessContext) {
    this.store.permission(context, 'exams.fields.edit')
    return this.store.run(id, dto.expectedVersion, context, async (exam, manager) => {
      this.store.assertMutable(exam)
      if (!['TO_PREPARE', 'PENDING', 'RECALLED'].includes(exam.workflowState))
        throw new ConflictException('Campos só podem ser corrigidos antes da liberação.')
      const allowed = [
        'requesterName',
        'requesterReference',
        'performingPhysician',
        'healthInsurance',
      ] as const
      const changes = Object.fromEntries(
        allowed
          .filter((key) => dto[key] !== undefined)
          .map((key) => [key, dto[key]!.trim() || null]),
      )
      if (!Object.keys(changes).length)
        throw new BadRequestException('Informe um campo operacional para alterar.')
      await manager.getRepository('ExamEntity').update(id, changes)
      const changed = await this.store.exam(id, context, manager)
      return this.store.change(
        changed,
        changed.workflowState,
        'EXAM_FIELDS_CHANGED',
        dto.reason,
        context,
        manager,
        { before: Object.fromEntries(allowed.map((key) => [key, exam[key]])), changes },
      )
    })
  }
  async priority(id: string, dto: PriorityChangeDto, context: CompanyAccessContext) {
    this.store.permission(context, 'exams.priority.edit')
    return this.store.run(id, dto.expectedVersion, context, async (exam, manager) => {
      this.store.assertMutable(exam)
      if (!['TO_PREPARE', 'PENDING', 'RECALLED'].includes(exam.workflowState))
        throw new ConflictException('Prioridade só pode ser ajustada antes da liberação.')
      if (exam.priority === dto.priority) throw new ConflictException('Prioridade já definida.')
      await manager.getRepository('ExamEntity').update(id, { priority: dto.priority })
      const changed = await this.store.exam(id, context, manager)
      return this.store.change(
        changed,
        changed.workflowState,
        'EXAM_PRIORITY_CHANGED',
        dto.reason,
        context,
        manager,
        { previous: exam.priority, current: dto.priority, slaRecalculation: 'PENDING_CONTRACT' },
      )
    })
  }
}
