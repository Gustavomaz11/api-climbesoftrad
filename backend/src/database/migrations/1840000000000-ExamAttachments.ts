import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ExamAttachments1840000000000 implements MigrationInterface {
  name = 'ExamAttachments1840000000000'
  async up(runner: QueryRunner) {
    await runner.query(`
      CREATE TABLE stored_objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
        exam_id uuid NOT NULL, storage_key varchar(500) NOT NULL UNIQUE,
        original_name varchar(255) NOT NULL, content_type varchar(120) NOT NULL,
        size_bytes integer NOT NULL CHECK(size_bytes > 0), sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
        status varchar(20) NOT NULL CHECK(status IN ('REGISTERED','STORED','UNREFERENCED')),
        created_by_user_id uuid NOT NULL REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(id,exam_id,company_id), FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id) ON DELETE RESTRICT
      );
      CREATE TABLE exam_attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, exam_id uuid NOT NULL,
        object_id uuid NOT NULL UNIQUE, category varchar(20) NOT NULL CHECK(category IN ('ORDER','QUESTIONNAIRE','COMPARATIVE')),
        version integer NOT NULL DEFAULT 1 CHECK(version > 0), replaces_id uuid UNIQUE,
        superseded_at timestamptz, validation_status varchar(30) NOT NULL CHECK(validation_status='SIGNATURE_VALIDATED'),
        reason varchar(500), created_by_user_id uuid NOT NULL REFERENCES auth_users(id),
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,exam_id,company_id),
        FOREIGN KEY(object_id,exam_id,company_id) REFERENCES stored_objects(id,exam_id,company_id),
        FOREIGN KEY(replaces_id,exam_id,company_id) REFERENCES exam_attachments(id,exam_id,company_id),
        CHECK((replaces_id IS NULL AND version=1) OR (replaces_id IS NOT NULL AND version>1 AND reason IS NOT NULL AND length(btrim(reason))>0))
      );
      CREATE INDEX exam_attachments_history ON exam_attachments(company_id,exam_id,created_at);
      CREATE INDEX stored_objects_reconciliation ON stored_objects(status) WHERE status <> 'STORED';
    `)
  }
  async down(runner: QueryRunner) {
    const [used] = (await runner.query(
      'SELECT COUNT(*)::int AS count FROM stored_objects',
    )) as Array<{ count: number }>
    if (used?.count)
      throw new Error(
        'Anexos preservados: restaure o backup e concilie os arquivos antes do rollback.',
      )
    await runner.query('DROP TABLE exam_attachments; DROP TABLE stored_objects;')
  }
}
