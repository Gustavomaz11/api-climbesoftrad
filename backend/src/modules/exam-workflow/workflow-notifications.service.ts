import { Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { WorkflowStoreService } from './workflow-store.service'

@Injectable()
export class WorkflowNotificationsService {
  constructor(
    private readonly database: DataSource,
    private readonly store: WorkflowStoreService,
    private readonly audit: OperationalAuditService,
  ) {}
  async list(context: CompanyAccessContext) {
    return this.database.query<unknown[]>(
      `SELECT i.*,e.patient_name,e.study_description,e.workflow_state,a.seen_at,
      EXTRACT(EPOCH FROM (COALESCE(i.resolved_at,now())-i.opened_at))::int AS elapsed_seconds
      FROM exam_workflow_issues i JOIN exams e ON e.id=i.exam_id
      LEFT JOIN exam_issue_acknowledgements a ON a.issue_id=i.id AND a.user_id=$2
      WHERE i.company_id=$1 AND ($3 OR i.unit_id=ANY($4::uuid[])) AND i.resolved_at IS NULL
      AND e.workflow_state<>'CANCELLED' AND e.archived_at IS NULL
      AND (i.responsible_user_id IS NULL OR i.responsible_user_id=$2 OR $5)
      ORDER BY i.opened_at LIMIT 100`,
      [
        context.companyId,
        context.userId,
        context.allUnits,
        context.unitIds,
        context.permissions.includes('exams.issues.manage'),
      ],
    )
  }
  async acknowledge(issueId: string, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      const [issue] = await manager.query<Array<{ exam_id: string }>>(
        'SELECT exam_id FROM exam_workflow_issues WHERE id=$1 AND company_id=$2',
        [issueId, context.companyId],
      )
      if (!issue) throw new NotFoundException('Notificação não encontrada.')
      const exam = await this.store.exam(issue.exam_id, context, manager)
      const inserted = await manager.query<unknown[]>(
        'INSERT INTO exam_issue_acknowledgements(issue_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING issue_id',
        [issueId, context.userId],
      )
      if (inserted.length)
        await this.audit.record(
          context,
          {
            action: 'EXAM_ISSUE_ACKNOWLEDGED',
            resourceType: 'workflow-issue',
            resourceId: issueId,
            unitId: exam.unitId,
          },
          manager,
        )
      return { seen: true }
    })
  }
}
