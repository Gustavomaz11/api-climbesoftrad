import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ReportCompletionDelivery1990000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE exam_report_completions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      exam_id uuid NOT NULL UNIQUE REFERENCES exams(id) ON DELETE RESTRICT,
      company_id uuid NOT NULL REFERENCES companies(id),
      unit_id uuid NOT NULL REFERENCES hospital_units(id),
      physician_user_id uuid NOT NULL REFERENCES auth_users(id),
      content_hash varchar(64) NOT NULL,
      snapshot jsonb NOT NULL,
      finalized_at timestamptz NOT NULL DEFAULT now(),
      origin_company_id uuid REFERENCES companies(id),
      origin_unit_id uuid REFERENCES hospital_units(id),
      sent_at timestamptz,
      sent_by_user_id uuid REFERENCES auth_users(id),
      CHECK ((origin_company_id IS NULL)=(origin_unit_id IS NULL)),
      CHECK ((sent_at IS NULL)=(sent_by_user_id IS NULL)),
      CHECK (sent_at IS NULL OR origin_unit_id IS NOT NULL)
    );
    CREATE INDEX report_hospital_results ON exam_report_completions(origin_company_id,origin_unit_id,sent_at DESC) WHERE sent_at IS NOT NULL;
    CREATE FUNCTION protect_completed_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF (to_jsonb(NEW)-'sent_at'-'sent_by_user_id') IS DISTINCT FROM (to_jsonb(OLD)-'sent_at'-'sent_by_user_id')
        OR (OLD.sent_at IS NOT NULL AND (NEW.sent_at,NEW.sent_by_user_id) IS DISTINCT FROM (OLD.sent_at,OLD.sent_by_user_id)) THEN
        RAISE EXCEPTION 'Completed report is immutable';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER immutable_completed_report BEFORE UPDATE ON exam_report_completions FOR EACH ROW EXECUTE FUNCTION protect_completed_report();`)
    for (const [code, group, name, roles] of [
      ['reports.finalize', 'Laudos', 'Finalizar laudo como médico', ['DOCTOR', 'ADMINISTRATOR']],
      ['reports.deliver', 'Laudos', 'Enviar laudo finalizado ao hospital', ['DOCTOR', 'ADMINISTRATOR', 'RECEPTION']],
      ['hospital.results.view', 'Hospital', 'Consultar laudos recebidos do ClimbeSoftRad', ['HOSPITAL', 'ADMINISTRATOR']],
    ] as const) {
      await q.query('INSERT INTO access_permissions(code,group_name,name) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING', [code, group, name])
      await q.query(`INSERT INTO access_role_permissions(role_id,permission_code) SELECT id,$1 FROM access_roles WHERE code=ANY($2::varchar[]) ON CONFLICT DO NOTHING`, [code, roles])
    }
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query("DELETE FROM access_role_permissions WHERE permission_code IN ('reports.finalize','reports.deliver','hospital.results.view')")
    await q.query("DELETE FROM access_permissions WHERE code IN ('reports.finalize','reports.deliver','hospital.results.view')")
    await q.query('DROP TABLE exam_report_completions; DROP FUNCTION protect_completed_report()')
  }
}
