import type { MigrationInterface, QueryRunner } from 'typeorm'
import {
  defaultRolePermissions,
  permissionCatalog,
} from '../../modules/access-control/permission.catalog'
import { workflowSchema } from './workflow-schema'
import { workflowEvidenceTriggers } from './workflow-evidence-triggers'

export class ExamWorkflow1890000000000 implements MigrationInterface {
  name = 'ExamWorkflow1890000000000'
  async up(runner: QueryRunner) {
    await runner.query(workflowSchema)
    await runner.query(workflowEvidenceTriggers)
    const old = (await runner.query('SELECT code FROM access_permissions')) as Array<{
      code: string
    }>
    const existing = new Set(old.map((entry) => entry.code))
    for (const p of permissionCatalog)
      await runner.query(
        'INSERT INTO access_permissions(code,group_name,name) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING',
        [p.code, p.group, p.name],
      )
    for (const [role, permissions] of Object.entries(defaultRolePermissions))
      for (const code of permissions)
        if (!existing.has(code))
          await runner.query(
            'INSERT INTO access_role_permissions(role_id,permission_code) SELECT id,$2 FROM access_roles WHERE code=$1 ON CONFLICT DO NOTHING',
            [role, code],
          )
  }
  async down(runner: QueryRunner) {
    const [used] = (await runner.query(
      'SELECT COUNT(*)::int AS count FROM exam_workflow_history',
    )) as Array<{ count: number }>
    if (used?.count)
      throw new Error(
        'Fluxo em uso. Preserve preparação, pendências e histórico antes de reverter.',
      )
    await runner.query(`DROP TRIGGER workflow_exam_fields ON exams;
      DROP TRIGGER workflow_attachment ON exam_attachments; DROP TRIGGER workflow_dicom ON dicom_instances;
      DROP TRIGGER workflow_comparative ON exam_comparatives;
      DROP FUNCTION workflow_evidence_changed(); DROP FUNCTION workflow_exam_fields_changed();
      DROP FUNCTION invalidate_exam_preparation(uuid,text,uuid);
      DROP TABLE exam_issue_acknowledgements,exam_workflow_issues,preparation_checks,exam_workflow_history,preparation_policies;
      ALTER TABLE exams DROP COLUMN workflow_state,DROP COLUMN workflow_version,DROP COLUMN evidence_version,
      DROP COLUMN prepared_at,DROP COLUMN prepared_by_user_id,DROP COLUMN archived_at,DROP COLUMN archived_by_user_id;`)
  }
}
