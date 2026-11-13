import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ReportLifecycle2060000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE exams DROP CONSTRAINT exams_workflow_state_check;
      ALTER TABLE exams ADD CONSTRAINT exams_workflow_state_check CHECK(workflow_state IN
        ('TO_PREPARE','READY','IN_PROGRESS','TYPED','SIGNED','RESIGNED','REVIEW','REVALIDATED','PENDING','RECALLED','CANCELLED'));
      ALTER TABLE exam_report_completions DROP CONSTRAINT exam_report_completions_exam_id_key;
      ALTER TABLE exam_report_completions ADD COLUMN version integer NOT NULL DEFAULT 1,
        ADD COLUMN previous_version_id uuid REFERENCES exam_report_completions(id),
        ADD COLUMN revision_reason varchar(1000), ADD COLUMN draft_hash varchar(64);
      ALTER TABLE exam_report_completions ADD CONSTRAINT report_version_unique UNIQUE(exam_id,version),
        ADD CONSTRAINT report_version_lineage CHECK((version=1 AND previous_version_id IS NULL) OR
          (version>1 AND previous_version_id IS NOT NULL AND length(trim(revision_reason))>=10));
      CREATE FUNCTION prevent_report_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'Signed report history cannot be deleted'; END $$;
      CREATE TRIGGER report_no_delete BEFORE DELETE ON exam_report_completions FOR EACH ROW EXECUTE FUNCTION prevent_report_deletion();
      UPDATE exams SET workflow_state='SIGNED' WHERE workflow_state='TYPED'
        AND EXISTS(SELECT 1 FROM exam_report_completions c WHERE c.exam_id=exams.id);
      CREATE TABLE exam_report_drafts (
        exam_id uuid PRIMARY KEY REFERENCES exams(id), content jsonb NOT NULL,
        content_hash varchar(64) NOT NULL, has_content boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by_user_id uuid NOT NULL REFERENCES auth_users(id),
        base_completion_id uuid REFERENCES exam_report_completions(id), revision_reason varchar(1000)
      );
      CREATE TABLE exam_report_sessions (
        exam_id uuid PRIMARY KEY REFERENCES exams(id), user_id uuid NOT NULL REFERENCES auth_users(id),
        client_id uuid NOT NULL, expires_at timestamptz NOT NULL,
        release_requested_at timestamptz, release_requested_by uuid REFERENCES auth_users(id), release_reason varchar(1000)
      );
      CREATE INDEX report_session_expiry ON exam_report_sessions(expires_at);
      CREATE TABLE exam_report_reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL REFERENCES exams(id),
        base_completion_id uuid NOT NULL REFERENCES exam_report_completions(id),
        reason varchar(1000) NOT NULL CHECK(length(trim(reason))>=10),
        requested_by_user_id uuid NOT NULL REFERENCES auth_users(id), requested_company_id uuid NOT NULL REFERENCES companies(id),
        requested_at timestamptz NOT NULL DEFAULT now(), status varchar(20) NOT NULL DEFAULT 'OPEN'
          CHECK(status IN ('OPEN','IN_PROGRESS','RESIGNED','REVALIDATED')),
        resolved_at timestamptz, resolved_by_user_id uuid REFERENCES auth_users(id), resolution_reason varchar(1000),
        resulting_completion_id uuid REFERENCES exam_report_completions(id)
      );
      CREATE UNIQUE INDEX report_review_open ON exam_report_reviews(exam_id) WHERE resolved_at IS NULL;
      CREATE TABLE exam_report_authorizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), base_completion_id uuid NOT NULL REFERENCES exam_report_completions(id),
        physician_user_id uuid NOT NULL REFERENCES auth_users(id), authorized_by_user_id uuid NOT NULL REFERENCES auth_users(id),
        reason varchar(1000) NOT NULL CHECK(length(trim(reason))>=10), created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(base_completion_id,physician_user_id)
      );
      ALTER TABLE exam_workflow_issues ADD COLUMN recall_purpose varchar(20) CHECK(recall_purpose IN ('CORRECTION','COMPLEMENT'));
      UPDATE exam_workflow_issues SET recall_purpose=CASE WHEN requested_action='DOCUMENTS' THEN 'COMPLEMENT' ELSE 'CORRECTION' END WHERE kind='RECALL';
    `)
    for (const [code, name, roles] of [
      ['reports.review.request', 'Solicitar reavaliação de laudo', ['HOSPITAL', 'ADMINISTRATOR']],
      ['reports.review.authorize', 'Autorizar outro médico a reassinar um laudo específico', ['ADMINISTRATOR']],
      ['reports.resign.other', 'Reassinar laudos de outros médicos como médico sênior', []],
      ['reports.session.force', 'Solicitar encerramento forçado do laudário', ['ADMINISTRATOR']],
    ] as const) {
      await q.query('INSERT INTO access_permissions(code,group_name,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [code, 'Laudos', name])
      await q.query('INSERT INTO access_role_permissions(role_id,permission_code) SELECT id,$1 FROM access_roles WHERE code=ANY($2::varchar[]) ON CONFLICT DO NOTHING', [code, roles])
    }
  }

  down(): Promise<void> {
    return Promise.reject(new Error('ReportLifecycle preserves signed history; use a forward migration instead of deleting versions.'))
  }
}
