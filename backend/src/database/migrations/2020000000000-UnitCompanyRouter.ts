import type { MigrationInterface, QueryRunner } from 'typeorm'

export class UnitCompanyRouter2020000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE hospital_units ADD COLUMN cnpj varchar(14), ADD COLUMN legal_name varchar(160),
      ADD COLUMN trade_name varchar(160), ADD COLUMN internal_identifier varchar(120), ADD COLUMN address jsonb,
      ADD COLUMN contact_phone varchar(30), ADD COLUMN contact_email varchar(254);
      ALTER TABLE dicom_sources ADD COLUMN requires_tls boolean NOT NULL DEFAULT false;
      CREATE TABLE router_installations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
        unit_id uuid NOT NULL, device_id uuid NOT NULL, source_id uuid NOT NULL UNIQUE REFERENCES dicom_sources(id),
        encrypted_token text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id), UNIQUE(unit_id,device_id));
      CREATE TABLE router_installer_tickets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
        unit_id uuid NOT NULL, code_hash varchar(64) NOT NULL UNIQUE, created_by_user_id uuid NOT NULL REFERENCES auth_users(id),
        created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
        installation_id uuid REFERENCES router_installations(id),
        FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id));
      CREATE INDEX router_unit_connections ON router_installations(company_id,unit_id);
      CREATE INDEX router_ticket_expiry ON router_installer_tickets(expires_at);`)
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE router_installer_tickets; DROP TABLE router_installations; ALTER TABLE dicom_sources DROP COLUMN requires_tls;
      ALTER TABLE hospital_units DROP COLUMN cnpj, DROP COLUMN legal_name, DROP COLUMN trade_name,
      DROP COLUMN internal_identifier, DROP COLUMN address, DROP COLUMN contact_phone, DROP COLUMN contact_email`)
  }
}
