import type { MigrationInterface, QueryRunner } from 'typeorm'

export class Physicians1760000000000 implements MigrationInterface {
  name = 'Physicians1760000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth_users
        ADD COLUMN username CITEXT UNIQUE,
        ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE auth_users DROP CONSTRAINT auth_users_role_check;
      ALTER TABLE auth_users
        ADD CONSTRAINT auth_users_role_check CHECK (role IN ('USER', 'ADMIN', 'DOCTOR'));

      CREATE TABLE physicians (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
        crm CITEXT NOT NULL UNIQUE,
        name VARCHAR(120) NOT NULL,
        specialty VARCHAR(120) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS physicians;')
    await queryRunner.query(`
      ALTER TABLE auth_users DROP CONSTRAINT auth_users_role_check;
      ALTER TABLE auth_users
        ADD CONSTRAINT auth_users_role_check CHECK (role IN ('USER', 'ADMIN'));
      ALTER TABLE auth_users
        DROP COLUMN IF EXISTS must_change_password,
        DROP COLUMN IF EXISTS username;
    `)
  }
}
