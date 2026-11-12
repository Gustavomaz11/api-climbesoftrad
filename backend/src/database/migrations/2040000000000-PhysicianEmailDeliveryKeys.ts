import type { MigrationInterface, QueryRunner } from 'typeorm'

export class PhysicianEmailDeliveryKeys2040000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE physician_access_emails ADD COLUMN delivery_key uuid NOT NULL DEFAULT gen_random_uuid()')
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE physician_access_emails DROP COLUMN delivery_key')
  }
}
