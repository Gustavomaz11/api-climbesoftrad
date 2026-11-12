import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AccountDisabledRevocationReason1790000000000 implements MigrationInterface {
  name = 'AccountDisabledRevocationReason1790000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_revocation_reason_check;
      ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_revocation_reason_check CHECK (
        revocation_reason IS NULL OR revocation_reason IN (
          'LOGOUT', 'REFRESH_TOKEN_REUSE', 'EXPIRED', 'ACCOUNT_DISABLED'
        )
      );
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE auth_sessions
      SET revocation_reason = 'EXPIRED'
      WHERE revocation_reason = 'ACCOUNT_DISABLED';
      ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_revocation_reason_check;
      ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_revocation_reason_check CHECK (
        revocation_reason IS NULL OR revocation_reason IN (
          'LOGOUT', 'REFRESH_TOKEN_REUSE', 'EXPIRED'
        )
      );
    `)
  }
}
