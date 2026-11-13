import type { MigrationInterface, QueryRunner } from 'typeorm'

export class PhysicianReportQueue2050000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE exams
        ADD COLUMN reporting_user_id uuid REFERENCES auth_users(id) ON DELETE RESTRICT,
        ADD COLUMN reporting_started_at timestamptz;
      UPDATE exams e SET reporting_user_id=c.physician_user_id, reporting_started_at=c.finalized_at
        FROM exam_report_completions c WHERE c.exam_id=e.id;
      UPDATE exams e SET reporting_user_id=h.actor_user_id, reporting_started_at=h.occurred_at
        FROM (
          SELECT DISTINCT ON (exam_id) exam_id, actor_user_id, occurred_at, to_state
          FROM exam_workflow_history ORDER BY exam_id, version DESC
        ) h JOIN auth_users u ON u.id=h.actor_user_id AND u.role='DOCTOR'
        WHERE e.id=h.exam_id AND e.workflow_state='IN_PROGRESS' AND h.to_state='IN_PROGRESS'
          AND e.reporting_user_id IS NULL;
      CREATE INDEX exams_reporting_queue_idx ON exams(company_id,reporting_user_id,performed_at DESC)
        WHERE reporting_user_id IS NOT NULL AND archived_at IS NULL;
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX exams_reporting_queue_idx;
      ALTER TABLE exams DROP COLUMN reporting_started_at, DROP COLUMN reporting_user_id;`)
  }
}
