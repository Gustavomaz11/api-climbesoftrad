import type { MigrationInterface, QueryRunner } from 'typeorm'

export class PortalAccess2090000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE company_memberships ADD COLUMN allowed_portals varchar[] NOT NULL DEFAULT ARRAY['sourad']::varchar[], ADD CONSTRAINT company_memberships_portals_check CHECK (allowed_portals <@ ARRAY['sourad','hospital','configuracoes']::varchar[])`)
    await runner.query(`UPDATE company_memberships m SET allowed_portals = CASE
      WHEN u.role = 'ADMIN' THEN ARRAY['sourad','hospital','configuracoes']::varchar[]
      WHEN u.role = 'DOCTOR' OR r.code IN ('DOCTOR','SENIOR_DOCTOR') THEN ARRAY['sourad']::varchar[]
      ELSE ARRAY(SELECT p FROM unnest(ARRAY['sourad','hospital','configuracoes']::varchar[]) p WHERE
        (p='sourad' AND EXISTS (SELECT 1 FROM access_role_permissions rp WHERE rp.role_id=r.id AND rp.permission_code IN ('exams.view','reports.view','patients.view')))
        OR (p='hospital' AND EXISTS (SELECT 1 FROM access_role_permissions rp WHERE rp.role_id=r.id AND rp.permission_code IN ('hospital.intake.view','hospital.results.view')))
        OR (p='configuracoes' AND EXISTS (SELECT 1 FROM access_role_permissions rp WHERE rp.role_id=r.id AND rp.permission_code IN ('users.create','memberships.manage','physicians.create','units.create','roles.create','roles.manage','companies.manage','company.settings.manage','exam.catalog.manage')))) END
      FROM auth_users u, access_roles r WHERE u.id=m.user_id AND r.id=m.access_role_id`)
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE company_memberships DROP COLUMN allowed_portals')
  }
}
