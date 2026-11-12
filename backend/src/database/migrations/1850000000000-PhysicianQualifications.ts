import type { MigrationInterface, QueryRunner } from 'typeorm'

export class PhysicianQualifications1850000000000 implements MigrationInterface {
  name = 'PhysicianQualifications1850000000000'
  async up(runner: QueryRunner) {
    await runner.query(`
      ALTER TABLE exam_types ADD CONSTRAINT exam_types_id_company_modality UNIQUE(id,company_id,modality);
      ALTER TABLE company_memberships ADD CONSTRAINT memberships_id_company_user UNIQUE(id,company_id,user_id);
      ALTER TABLE physicians ADD CONSTRAINT physicians_id_user UNIQUE(id,user_id);
      CREATE TABLE physician_qualifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
        membership_id uuid NOT NULL, physician_id uuid NOT NULL, user_id uuid NOT NULL,
        unit_id uuid NOT NULL, exam_type_id uuid NOT NULL, modality varchar(10) NOT NULL,
        active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 0 CHECK(version >= 0),
        reason varchar(500) NOT NULL CHECK(length(btrim(reason)) >= 3),
        created_by_user_id uuid NOT NULL REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(membership_id,unit_id,exam_type_id),
        FOREIGN KEY(membership_id,company_id,user_id) REFERENCES company_memberships(id,company_id,user_id),
        FOREIGN KEY(physician_id,user_id) REFERENCES physicians(id,user_id),
        FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id),
        FOREIGN KEY(exam_type_id,company_id,modality) REFERENCES exam_types(id,company_id,modality)
      );
      CREATE INDEX physician_qualifications_eligibility ON physician_qualifications(company_id,unit_id,exam_type_id) WHERE active;
    `)
    const existing = (await runner.query(
      "SELECT code FROM access_permissions WHERE code='physicians.qualifications.manage'",
    )) as unknown[]
    await runner.query(
      `INSERT INTO access_permissions(code,group_name,name) VALUES ('physicians.qualifications.manage','Médicos','Administrar habilitações por tipo de exame e unidade') ON CONFLICT(code) DO NOTHING`,
    )
    if (!existing.length)
      await runner.query(
        `INSERT INTO access_role_permissions(role_id,permission_code) SELECT id,'physicians.qualifications.manage' FROM access_roles WHERE code='ADMINISTRATOR' ON CONFLICT DO NOTHING`,
      )
  }
  async down(runner: QueryRunner) {
    const [used] = (await runner.query(
      'SELECT COUNT(*)::int AS count FROM physician_qualifications',
    )) as Array<{ count: number }>
    if (used?.count)
      throw new Error(
        'Habilitações em uso: restaure o backup e concilie as alterações antes do rollback.',
      )
    await runner.query(`DROP TABLE physician_qualifications;
      ALTER TABLE physicians DROP CONSTRAINT physicians_id_user;
      ALTER TABLE company_memberships DROP CONSTRAINT memberships_id_company_user;
      ALTER TABLE exam_types DROP CONSTRAINT exam_types_id_company_modality;`)
  }
}
