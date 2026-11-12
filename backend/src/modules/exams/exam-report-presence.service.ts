import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { ExamReportPresenceEntity } from '../../database/entities/exam-report-presence.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { ExamAccessService } from './exam-access.service'
import { WorkflowStoreService } from '../exam-workflow/workflow-store.service'

@Injectable()
export class ExamReportPresenceService {
  constructor(
    private readonly database: DataSource,
    private readonly access: ExamAccessService,
    private readonly audit: OperationalAuditService,
    private readonly workflow: WorkflowStoreService,
  ) {}

  async touch(examId: string, context: CompanyAccessContext, clientId: string) {
    await this.workflow.writable(examId, context, async (exam, manager) => {
      const repository = manager.getRepository(ExamReportPresenceEntity)
      const where = { examId, userId: context.userId, clientId }
      const existing = await repository.existsBy(where)
      await repository.upsert({ ...where, lastSeenAt: new Date() }, [
        'examId',
        'userId',
        'clientId',
      ])
      if (!existing)
        await this.audit.record(
          context,
          {
            action: 'REPORT_PRESENCE_STARTED',
            resourceType: 'exam',
            resourceId: examId,
            unitId: exam.unitId,
          },
          manager,
        )
    })
    return { active: true }
  }

  async release(examId: string, context: CompanyAccessContext, clientId: string) {
    const exam = await this.access.require(examId, context)
    await this.database.transaction(async (manager) => {
      const deleted = await manager.getRepository(ExamReportPresenceEntity).delete({
        examId,
        userId: context.userId,
        clientId,
      })
      if (deleted.affected)
        await this.audit.record(
          context,
          {
            action: 'REPORT_PRESENCE_ENDED',
            resourceType: 'exam',
            resourceId: examId,
            unitId: exam.unitId,
          },
          manager,
        )
    })
    return { active: false }
  }
}
