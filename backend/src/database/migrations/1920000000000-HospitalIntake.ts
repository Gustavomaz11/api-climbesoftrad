import type { MigrationInterface, QueryRunner } from 'typeorm'

export class HospitalIntake1920000000000 implements MigrationInterface {
  name = 'HospitalIntake1920000000000'
  async up(runner: QueryRunner) {
    await runner.query(`
      CREATE TABLE hospital_intakes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,
        study_uid varchar(64) NOT NULL,identity_hash varchar(64) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED')),
        version integer NOT NULL DEFAULT 0,fields jsonb NOT NULL DEFAULT '{}',submitted_fields jsonb,issues jsonb NOT NULL DEFAULT '[]',
        exam_id uuid,submitted_at timestamptz,submitted_by_user_id uuid REFERENCES auth_users(id),
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(company_id,unit_id,study_uid),UNIQUE(id,unit_id,company_id),
        FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id),
        FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id)
      );
      CREATE INDEX hospital_intakes_queue ON hospital_intakes(company_id,unit_id,status,updated_at DESC);
      ALTER TABLE upload_sessions ADD COLUMN intake_id uuid;
      ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_intake_fk FOREIGN KEY(intake_id,unit_id,company_id) REFERENCES hospital_intakes(id,unit_id,company_id);
      CREATE INDEX upload_sessions_intake ON upload_sessions(intake_id,status);
      ALTER TABLE upload_sessions DROP CONSTRAINT upload_sessions_status_check;
      ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_status_check CHECK(status IN
        ('UPLOADING','RECEIVED','VALIDATING','APPROVED','QUARANTINED','REJECTED','PUBLISHED','CANCELLED','EXPIRED','AWAITING_REVIEW'));
      INSERT INTO access_permissions(code,group_name,name) VALUES
        ('hospital.intake.view','Hospital','Consultar estudos em preparação no hospital'),
        ('hospital.intake.submit','Hospital','Revisar cadastro e enviar estudos à SouRad') ON CONFLICT DO NOTHING;
      INSERT INTO access_role_permissions(role_id,permission_code)
        SELECT id,p.code FROM access_roles CROSS JOIN access_permissions p
        WHERE access_roles.code='ADMINISTRATOR' AND p.code IN ('hospital.intake.view','hospital.intake.submit') ON CONFLICT DO NOTHING;
      INSERT INTO access_roles(company_id,code,name,description,immutable)
        SELECT id,'HOSPITAL','Hospital — envio de exames','Prepara estudos da unidade e envia à SouRad',false FROM companies
        ON CONFLICT(company_id,code) DO NOTHING;
      INSERT INTO access_role_permissions(role_id,permission_code)
        SELECT id,p.code FROM access_roles CROSS JOIN access_permissions p WHERE access_roles.code='HOSPITAL'
        AND p.code IN ('hospital.intake.view','hospital.intake.submit','dicom.import','companies.view') ON CONFLICT DO NOTHING;
    `)
  }
  async down(runner: QueryRunner) {
    const [used] = await runner.query('SELECT COUNT(*)::int AS count FROM hospital_intakes') as Array<{ count: number }>
    if (used?.count) throw new Error('Estudos hospitalares em uso: preserve os envios antes de reverter.')
    await runner.query(`ALTER TABLE upload_sessions DROP COLUMN intake_id;
      DROP TABLE hospital_intakes;
      ALTER TABLE upload_sessions DROP CONSTRAINT upload_sessions_status_check;
      ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_status_check CHECK(status IN
        ('UPLOADING','RECEIVED','VALIDATING','APPROVED','QUARANTINED','REJECTED','PUBLISHED','CANCELLED','EXPIRED'));`)
  }
}
