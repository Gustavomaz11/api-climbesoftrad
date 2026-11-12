import type { MigrationInterface, QueryRunner } from 'typeorm'
import {
  permissionCatalog,
  defaultRolePermissions,
} from '../../modules/access-control/permission.catalog'
import { companyAccessConstraints, companyAccessSchema } from './schema/company-access-schema'
import { initialCompanyId, resolveLegacyCompanyName } from './schema/legacy-company-mapping'

export class CompanyAccess1820000000000 implements MigrationInterface {
  name = 'CompanyAccess1820000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const counts = (await queryRunner.query(`
      SELECT ((SELECT COUNT(*) FROM hospital_units) + (SELECT COUNT(*) FROM exams)
        + (SELECT COUNT(*) FROM auth_users))::text AS count
    `)) as Array<{ count: string }>
    const name = resolveLegacyCompanyName(
      process.env.LEGACY_COMPANY_NAME,
      Number(counts[0]?.count ?? 0),
    )
    await queryRunner.query(companyAccessSchema)
    await queryRunner.query('INSERT INTO companies(id, name) VALUES ($1, $2)', [
      initialCompanyId,
      name,
    ])
    await this.removeGlobalUniqueConstraints(queryRunner)
    await queryRunner.query('UPDATE hospital_units SET company_id = $1', [initialCompanyId])
    await queryRunner.query('UPDATE access_roles SET company_id = $1', [initialCompanyId])
    await queryRunner.query('UPDATE exams SET company_id = $1', [initialCompanyId])
    await queryRunner.query(companyAccessConstraints)
    await queryRunner.query(
      `
      INSERT INTO company_memberships(company_id, user_id, access_role_id, active, all_units)
      SELECT $1, id, access_role_id, status = 'ACTIVE', TRUE FROM auth_users
    `,
      [initialCompanyId],
    )
    await queryRunner.query(`
      -- Disabled legacy physicians had a global flag for a company revocation.
      -- Preserve that revocation in the membership while keeping identity reusable.
      UPDATE auth_users SET status = 'ACTIVE'
      WHERE role = 'DOCTOR' AND status = 'DISABLED';
    `)
    const previousPermissions = (await queryRunner.query(
      'SELECT code FROM access_permissions',
    )) as Array<{ code: string }>
    const previousCodes = new Set(previousPermissions.map((permission) => permission.code))
    for (const permission of permissionCatalog) {
      await queryRunner.query(
        `
        INSERT INTO access_permissions(code, group_name, name) VALUES ($1, $2, $3)
        ON CONFLICT(code) DO UPDATE SET group_name = EXCLUDED.group_name, name = EXCLUDED.name
      `,
        [permission.code, permission.group, permission.name],
      )
    }
    for (const [code, permissions] of Object.entries(defaultRolePermissions)) {
      for (const permission of permissions) {
        // Preserve deliberate edits to existing roles. Only newly introduced
        // permissions receive the default grants during this migration.
        if (previousCodes.has(permission)) continue
        await queryRunner.query(
          `
          INSERT INTO access_role_permissions(role_id, permission_code)
          SELECT id, $2 FROM access_roles WHERE company_id = $3 AND code = $1
          ON CONFLICT DO NOTHING
        `,
          [code, permission, initialCompanyId],
        )
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [company] = (await queryRunner.query(
      'SELECT COUNT(*)::text AS count FROM companies',
    )) as Array<{ count: string }>
    const [settings] = (await queryRunner.query(`
      SELECT ((SELECT COUNT(*) FROM company_settings_revisions) +
        (SELECT COUNT(*) FROM operational_events))::text AS count
    `)) as Array<{ count: string }>
    if (Number(company?.count) > 1 || Number(settings?.count) > 0) {
      throw new Error(
        'Reversão exige restauração do backup: existem dados de múltiplas empresas ou evidências novas.',
      )
    }
    await queryRunner.query(`
      UPDATE auth_users users SET status = 'DISABLED' FROM company_memberships memberships
      WHERE users.id = memberships.user_id AND users.role = 'DOCTOR' AND NOT memberships.active;
      DROP TABLE operational_events;
      DROP TABLE company_settings_revisions;
      DROP TABLE company_membership_units;
      DROP TABLE company_memberships;
      ALTER TABLE exams DROP CONSTRAINT exams_unit_company_fk;
      DROP INDEX exams_company_performed;
      ALTER TABLE exams DROP COLUMN company_id;
      ALTER TABLE hospital_units DROP CONSTRAINT hospital_units_company_name;
      ALTER TABLE hospital_units DROP CONSTRAINT hospital_units_id_company;
      ALTER TABLE hospital_units DROP CONSTRAINT hospital_units_company_fk;
      ALTER TABLE hospital_units DROP COLUMN company_id;
      ALTER TABLE hospital_units ADD CONSTRAINT hospital_units_name_key UNIQUE(name);
      ALTER TABLE access_roles DROP CONSTRAINT access_roles_company_code;
      ALTER TABLE access_roles DROP CONSTRAINT access_roles_company_name;
      ALTER TABLE access_roles DROP CONSTRAINT access_roles_id_company;
      ALTER TABLE access_roles DROP CONSTRAINT access_roles_company_fk;
      ALTER TABLE access_roles DROP COLUMN company_id;
      ALTER TABLE access_roles ADD CONSTRAINT access_roles_code_key UNIQUE(code);
      DROP TABLE companies;
    `)
  }

  private async removeGlobalUniqueConstraints(queryRunner: QueryRunner) {
    const constraints = (await queryRunner.query(`
      SELECT relations.relname AS "table", conname AS name
      FROM pg_constraint JOIN pg_class relations ON relations.oid = conrelid WHERE conrelid IN ('hospital_units'::regclass, 'access_roles'::regclass)
        AND contype = 'u'
    `)) as Array<{ table: string; name: string }>
    for (const constraint of constraints) {
      const table = constraint.table.replaceAll('"', '""')
      const name = constraint.name.replaceAll('"', '""')
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`)
    }
  }
}
