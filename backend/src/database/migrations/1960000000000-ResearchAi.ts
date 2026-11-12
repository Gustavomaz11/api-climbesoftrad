import type { MigrationInterface, QueryRunner } from 'typeorm'
export class ResearchAi1960000000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`
    CREATE TABLE research_ai_cases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,exam_id uuid NOT NULL,
      created_by_user_id uuid NOT NULL REFERENCES auth_users(id),context jsonb NOT NULL,
      source_hash varchar(64) NOT NULL,source_snapshot jsonb NOT NULL,status varchar(20) NOT NULL DEFAULT 'PREPARING'
        CHECK(status IN ('PREPARING','REVIEW','QUEUED','RUNNING','COMPLETED','FAILED','STALE')),
      model varchar(100) NOT NULL,prompt_version varchar(80) NOT NULL,anonymization_version varchar(80) NOT NULL,
      frames_expected int NOT NULL DEFAULT 0,frames_prepared int NOT NULL DEFAULT 0,batches_completed int NOT NULL DEFAULT 0,
      result jsonb,error_code varchar(80),lease_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id),FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id)
    );
    CREATE UNIQUE INDEX research_ai_active_job ON research_ai_cases(exam_id,created_by_user_id)
      WHERE status IN ('PREPARING','REVIEW','QUEUED','RUNNING');
    CREATE TABLE research_ai_frames (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES research_ai_cases(id) ON DELETE CASCADE,
      instance_id uuid NOT NULL REFERENCES dicom_instances(id),frame_index int NOT NULL,sequence int NOT NULL,
      width int NOT NULL,height int NOT NULL,base_key text NOT NULL,redacted_key text NOT NULL,
      masks jsonb NOT NULL,automatic_masks jsonb NOT NULL,revision int NOT NULL DEFAULT 1,reviewed_revision int,sha256 varchar(64) NOT NULL,
      UNIQUE(case_id,instance_id,frame_index),UNIQUE(case_id,sequence)
    );
    CREATE TABLE research_ai_batches (
      case_id uuid NOT NULL REFERENCES research_ai_cases(id) ON DELETE CASCADE,number int NOT NULL,
      image_ids uuid[] NOT NULL,result jsonb NOT NULL,PRIMARY KEY(case_id,number)
    );
    CREATE TABLE research_ai_feedback (
      case_id uuid NOT NULL REFERENCES research_ai_cases(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES auth_users(id),
      useful boolean NOT NULL,comment varchar(1000) NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(case_id,user_id)
    );
    INSERT INTO access_permissions(code,group_name,name) VALUES('research.ai.use','Pesquisa','Usar análise de IA em pesquisa, sem finalidade clínica') ON CONFLICT DO NOTHING;
    INSERT INTO access_role_permissions(role_id,permission_code) SELECT id,'research.ai.use' FROM access_roles WHERE code IN ('ADMINISTRATOR','DOCTOR') ON CONFLICT DO NOTHING;
  `)
  }
  async down(runner: QueryRunner) {
    const [used] = (await runner.query(
      'SELECT count(*)::int AS count FROM research_ai_cases',
    )) as Array<{ count: number }>
    if (used?.count) throw new Error('Preserve research records and feedback before reverting')
    await runner.query(
      'DROP TABLE research_ai_feedback,research_ai_batches,research_ai_frames,research_ai_cases;',
    )
  }
}
