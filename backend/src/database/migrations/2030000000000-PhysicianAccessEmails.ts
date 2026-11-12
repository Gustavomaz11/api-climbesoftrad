import type { MigrationInterface, QueryRunner } from 'typeorm'

export class PhysicianAccessEmails2030000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE physician_access_emails (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      membership_id uuid NOT NULL UNIQUE REFERENCES company_memberships(id) ON DELETE CASCADE,
      status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
      initial_access boolean NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      locked_until timestamptz,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    ); CREATE INDEX physician_access_email_pending ON physician_access_emails(next_attempt_at) WHERE status <> 'SENT';`)
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE physician_access_emails')
  }
}
