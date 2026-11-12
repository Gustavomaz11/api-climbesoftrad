import type { MigrationInterface, QueryRunner } from 'typeorm'
import { standardModalities } from '../../modules/exam-modalities/standard-modalities'

export class SoftwareConfiguration1950000000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`
      ALTER TABLE physicians ADD COLUMN contact_phone varchar(30), ADD COLUMN registry_profile jsonb;
      ALTER TABLE hospital_units ADD COLUMN uf varchar(2);
      CREATE TABLE physician_registry_lookups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),
        user_id uuid NOT NULL REFERENCES auth_users(id),profile jsonb NOT NULL,
        expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',consumed_at timestamptz
      );
      CREATE INDEX ON physician_registry_lookups(expires_at);
      CREATE TABLE physician_crm_registrations (
        physician_id uuid NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
        crm varchar(10) NOT NULL,uf varchar(2) NOT NULL,PRIMARY KEY(crm,uf)
      );
      INSERT INTO medical_specialties(id,name,display_order,active,source_reference)
      VALUES('00000000-0000-4000-8000-000000000099','Sem especialidade registrada',999,true,'Cadastro CFM sem especialidade registrada') ON CONFLICT DO NOTHING;
      CREATE TABLE exam_modalities (
        company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,code varchar(16) NOT NULL,
        name varchar(180) NOT NULL,active boolean NOT NULL DEFAULT true,standard boolean NOT NULL DEFAULT false,
        PRIMARY KEY(company_id,code),CHECK(code ~ '^[A-Z][A-Z0-9_]{0,15}$')
      );
      ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_modality_check;
      ALTER TABLE exam_types DROP CONSTRAINT IF EXISTS exam_types_modality_check;
    `)
    for (const table of ['exams','exam_types','exam_type_aliases','physician_qualifications','contrast_protocols','exam_price_rules']) {
      await runner.query(`ALTER TABLE ${table} ALTER COLUMN modality TYPE varchar(16)`)
    }
    await runner.query(`INSERT INTO exam_modalities(company_id,code,name,standard)
      SELECT companies.id,defaults.code,defaults.name,true FROM companies CROSS JOIN
      jsonb_to_recordset($1::jsonb) AS defaults(code text,name text) ON CONFLICT DO NOTHING`, [JSON.stringify(standardModalities)])
  }
  async down(runner: QueryRunner) {
    await runner.query(`DROP TABLE exam_modalities; DROP TABLE physician_crm_registrations; DROP TABLE physician_registry_lookups;
      ALTER TABLE hospital_units DROP COLUMN uf; ALTER TABLE physicians DROP COLUMN contact_phone,DROP COLUMN registry_profile;`)
    // Keep wider modality columns and the specialty to preserve any records using them.
  }
}
