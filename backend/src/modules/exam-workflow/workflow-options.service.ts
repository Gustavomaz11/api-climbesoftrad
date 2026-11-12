import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { CompanyScopeService } from '../companies/company-scope.service'
import { WorkflowStoreService } from './workflow-store.service'

@Injectable()
export class WorkflowOptionsService {
  constructor(
    private readonly database: DataSource,
    private readonly store: WorkflowStoreService,
    private readonly scope: CompanyScopeService,
  ) {}
  async responsibles(unitId: string, context: CompanyAccessContext) {
    await this.scope.requireUnit(unitId, context)
    return this.database.query<Array<{ id: string; name: string }>>(
      `SELECT DISTINCT u.id,u.full_name AS name FROM auth_users u
      JOIN company_memberships m ON m.user_id=u.id AND m.company_id=$1 AND m.active
      JOIN access_roles r ON r.id=m.access_role_id AND r.active
      JOIN access_role_permissions p ON p.role_id=r.id AND p.permission_code='exams.view'
      WHERE u.status='ACTIVE' AND (m.all_units OR EXISTS(SELECT 1 FROM company_membership_units mu
        WHERE mu.membership_id=m.id AND mu.unit_id=$2 AND mu.active)) ORDER BY name`,
      [context.companyId, unitId],
    )
  }
  async evidence(id: string, context: CompanyAccessContext) {
    const exam = await this.store.exam(id, context)
    const attachments = context.permissions.includes('attachments.view')
      ? await this.database.query<unknown[]>(
          `SELECT a.id,a.exam_id,o.original_name AS name,a.created_at FROM exam_attachments a
      JOIN stored_objects o ON o.id=a.object_id JOIN exams e ON e.id=a.exam_id
      WHERE e.company_id=$1 AND e.patient_id=$2 AND e.unit_id=$3 AND a.superseded_at IS NULL AND a.validation_status='APPROVED'
      AND o.status='STORED' ORDER BY a.created_at DESC LIMIT 100`,
          [exam.companyId, exam.patientId, exam.unitId],
        )
      : []
    const studies = context.permissions.includes('exams.viewer.open')
      ? await this.database.query<unknown[]>(
          `SELECT s.id,s.exam_id,s.study_uid AS name,s.created_at,s.completed_at FROM dicom_studies s
      JOIN exams e ON e.id=s.exam_id WHERE e.company_id=$1 AND e.patient_id=$2 AND e.unit_id=$3 ORDER BY s.created_at DESC LIMIT 100`,
          [exam.companyId, exam.patientId, exam.unitId],
        )
      : []
    const complements = await this.database.query<unknown[]>(
      `SELECT id,study_description AS name,created_at FROM exams WHERE company_id=$1 AND patient_id=$2 AND unit_id=$3 AND id<>$4 AND workflow_state<>'CANCELLED'
      AND exam_type_id IS NOT DISTINCT FROM $5::uuid AND modality=$6 ORDER BY created_at DESC LIMIT 100`,
      [exam.companyId, exam.patientId, exam.unitId, exam.id, exam.examTypeId, exam.modality],
    )
    const comments = context.permissions.includes('comments.view')
      ? await this.database.query<unknown[]>(
          'SELECT id,created_at FROM exam_comments WHERE company_id=$1 AND exam_id=$2 ORDER BY created_at DESC LIMIT 100',
          [exam.companyId, id],
        )
      : []
    return { attachments, studies, complements, comments }
  }
}
