import type { MigrationInterface, QueryRunner } from 'typeorm'

export class PhysicianSignatureImage2010000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE physicians ADD COLUMN signature_image jsonb,
      ADD CONSTRAINT physician_signature_image_valid CHECK (signature_image IS NULL OR (
        jsonb_typeof(signature_image)='object'
        AND signature_image ?& ARRAY['id','dataUrl','sha256','registeredAt']
        AND signature_image->>'id' ~ '^[a-f0-9-]{36}$'
        AND signature_image->>'sha256' ~ '^[a-f0-9]{64}$'
        AND signature_image->>'dataUrl' ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'
        AND length(signature_image->>'dataUrl')<=350000))`)
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE physicians DROP CONSTRAINT physician_signature_image_valid, DROP COLUMN signature_image')
  }
}
