import type { MigrationInterface, QueryRunner } from 'typeorm'
import { defaultRolePermissions, permissionCatalog } from '../../modules/access-control/permission.catalog'

const initialRoles = [
  { code: 'ADMINISTRATOR', name: 'Administrador', description: 'Acesso total e imutÃ¡vel ao sistema.', immutable: true },
  { code: 'DOCTOR', name: 'MÃ©dico', description: 'Laudos, prescriÃ§Ãµes e atividades clÃ­nicas.', immutable: false },
  { code: 'RECEPTION', name: 'RecepÃ§Ã£o', description: 'Cadastro e acompanhamento operacional de exames.', immutable: false },
  { code: 'TECHNICIAN', name: 'TÃ©cnico', description: 'OperaÃ§Ã£o tÃ©cnica e anexos dos exames.', immutable: false },
  { code: 'READ_ONLY', name: 'Somente leitura', description: 'Consulta sem alteraÃ§Ã£o de dados.', immutable: false },
] as const

export class AccessControl1800000000000 implements MigrationInterface {
  name = 'AccessControl1800000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE access_permissions (
        code VARCHAR(80) PRIMARY KEY,
        group_name VARCHAR(80) NOT NULL,
        name VARCHAR(120) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE access_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(80) NOT NULL UNIQUE,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(300),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        immutable BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE access_role_permissions (
        role_id UUID NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
        permission_code VARCHAR(80) NOT NULL REFERENCES access_permissions(code) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_code)
      );

      ALTER TABLE auth_users ADD COLUMN access_role_id UUID;
    `)

    for (const permission of permissionCatalog) {
      await queryRunner.query(
        `INSERT INTO access_permissions (code, group_name, name) VALUES ($1, $2, $3)`,
        [permission.code, permission.group, permission.name],
      )
    }

    for (const role of initialRoles) {
      await queryRunner.query(
        `INSERT INTO access_roles (code, name, description, immutable) VALUES ($1, $2, $3, $4)`,
        [role.code, role.name, role.description, role.immutable],
      )
      for (const permissionCode of defaultRolePermissions[role.code] ?? []) {
        await queryRunner.query(
          `INSERT INTO access_role_permissions (role_id, permission_code)
           SELECT id, $2 FROM access_roles WHERE code = $1`,
          [role.code, permissionCode],
        )
      }
    }

    await queryRunner.query(`
      UPDATE auth_users users
      SET access_role_id = roles.id
      FROM access_roles roles
      WHERE roles.code = CASE
        WHEN users.role = 'ADMIN' THEN 'ADMINISTRATOR'
        WHEN users.role = 'DOCTOR' THEN 'DOCTOR'
        ELSE 'RECEPTION'
      END;

      ALTER TABLE auth_users ALTER COLUMN access_role_id SET NOT NULL;
      ALTER TABLE auth_users ADD CONSTRAINT auth_users_access_role_fk
        FOREIGN KEY (access_role_id) REFERENCES access_roles(id) ON DELETE RESTRICT;
      CREATE INDEX idx_auth_users_access_role_id ON auth_users(access_role_id);

      ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_revocation_reason_check;
      ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_revocation_reason_check CHECK (
        revocation_reason IS NULL OR revocation_reason IN (
          'LOGOUT', 'REFRESH_TOKEN_REUSE', 'EXPIRED', 'ACCOUNT_DISABLED', 'ROLE_DISABLED', 'ROLE_CHANGED'
        )
      );
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE auth_sessions SET revocation_reason = 'EXPIRED'
      WHERE revocation_reason IN ('ROLE_DISABLED', 'ROLE_CHANGED');
      ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_revocation_reason_check;
      ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_revocation_reason_check CHECK (
        revocation_reason IS NULL OR revocation_reason IN (
          'LOGOUT', 'REFRESH_TOKEN_REUSE', 'EXPIRED', 'ACCOUNT_DISABLED'
        )
      );
      ALTER TABLE auth_users DROP CONSTRAINT auth_users_access_role_fk;
      DROP INDEX idx_auth_users_access_role_id;
      ALTER TABLE auth_users DROP COLUMN access_role_id;
      DROP TABLE access_role_permissions;
      DROP TABLE access_roles;
      DROP TABLE access_permissions;
    `)
  }
}
