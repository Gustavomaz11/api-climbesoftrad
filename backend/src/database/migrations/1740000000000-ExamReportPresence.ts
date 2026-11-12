import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ExamReportPresence1740000000000 implements MigrationInterface {
  name = 'ExamReportPresence1740000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE exam_report_presences (
        exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        client_id UUID NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (exam_id, user_id, client_id)
      );

      CREATE INDEX idx_exam_report_presences_active
        ON exam_report_presences(exam_id, last_seen_at DESC);
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS exam_report_presences;')
  }
}
