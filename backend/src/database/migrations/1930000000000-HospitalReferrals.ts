import type { MigrationInterface, QueryRunner } from 'typeorm'

export class HospitalReferrals1930000000000 implements MigrationInterface {
  name = 'HospitalReferrals1930000000000'
  async up(runner: QueryRunner) {
    await runner.query(`
      CREATE TABLE hospital_referral_routes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,
        recipient_company_id uuid NOT NULL,recipient_unit_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,
        created_by_user_id uuid NOT NULL REFERENCES auth_users(id),created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(company_id,unit_id),CHECK(company_id<>recipient_company_id),
        FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id),
        FOREIGN KEY(recipient_unit_id,recipient_company_id) REFERENCES hospital_units(id,company_id)
      );
      ALTER TABLE hospital_intakes ADD COLUMN recipient_company_id uuid,ADD COLUMN recipient_unit_id uuid;
      UPDATE hospital_intakes i SET recipient_company_id=e.company_id,recipient_unit_id=e.unit_id FROM exams e WHERE e.id=i.exam_id;
      ALTER TABLE hospital_intakes DROP CONSTRAINT hospital_intakes_exam_id_company_id_fkey;
      ALTER TABLE hospital_intakes ADD CONSTRAINT hospital_intakes_recipient_unit_fk FOREIGN KEY(recipient_unit_id,recipient_company_id) REFERENCES hospital_units(id,company_id);
      ALTER TABLE hospital_intakes ADD CONSTRAINT hospital_intakes_recipient_exam_fk FOREIGN KEY(exam_id,recipient_company_id) REFERENCES exams(id,company_id);
      ALTER TABLE hospital_intakes ADD CONSTRAINT hospital_intakes_recipient_required CHECK(exam_id IS NULL OR (recipient_company_id IS NOT NULL AND recipient_unit_id IS NOT NULL));
      ALTER TABLE upload_sessions ADD COLUMN origin_upload_id uuid UNIQUE REFERENCES upload_sessions(id),ADD COLUMN forwarded_upload_id uuid REFERENCES upload_sessions(id);
      ALTER TABLE upload_sessions DROP CONSTRAINT upload_sessions_status_check;
      ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_status_check CHECK(status IN
        ('UPLOADING','RECEIVED','VALIDATING','APPROVED','QUARANTINED','REJECTED','PUBLISHED','CANCELLED','EXPIRED','AWAITING_REVIEW','FORWARDED'));
      INSERT INTO access_permissions(code,group_name,name) VALUES('hospital.referrals.manage','Hospital','Configurar encaminhamentos entre empresas') ON CONFLICT DO NOTHING;
      INSERT INTO access_role_permissions(role_id,permission_code) SELECT id,'hospital.referrals.manage' FROM access_roles WHERE code='ADMINISTRATOR' ON CONFLICT DO NOTHING;
    `)
  }
  async down(runner: QueryRunner) {
    const [used] = await runner.query('SELECT COUNT(*)::int AS count FROM hospital_referral_routes') as Array<{ count: number }>
    if (used?.count) throw new Error('Encaminhamentos em uso: preserve os vínculos entre empresas antes de reverter.')
    await runner.query(`ALTER TABLE upload_sessions DROP CONSTRAINT upload_sessions_status_check;
      ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_status_check CHECK(status IN
        ('UPLOADING','RECEIVED','VALIDATING','APPROVED','QUARANTINED','REJECTED','PUBLISHED','CANCELLED','EXPIRED','AWAITING_REVIEW'));
      ALTER TABLE hospital_intakes DROP CONSTRAINT hospital_intakes_recipient_exam_fk,DROP CONSTRAINT hospital_intakes_recipient_unit_fk,DROP CONSTRAINT hospital_intakes_recipient_required;
      ALTER TABLE hospital_intakes ADD FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id);
      ALTER TABLE hospital_intakes DROP COLUMN recipient_company_id,DROP COLUMN recipient_unit_id;
      ALTER TABLE upload_sessions DROP COLUMN origin_upload_id,DROP COLUMN forwarded_upload_id;
      DROP TABLE hospital_referral_routes;`)
  }
}
