import type { MigrationInterface, QueryRunner } from 'typeorm'

export class UserRoles1730000000000 implements MigrationInterface {
  name = 'UserRoles1730000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth_users
        ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'USER'
        CHECK (role IN ('USER', 'ADMIN'));
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE auth_users DROP COLUMN IF EXISTS role;')
  }
}
