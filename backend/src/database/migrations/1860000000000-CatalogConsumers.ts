import type { MigrationInterface, QueryRunner } from 'typeorm'
import {
  defaultRolePermissions,
  permissionCatalog,
} from '../../modules/access-control/permission.catalog'
export class CatalogConsumers1860000000000 implements MigrationInterface {
  name = 'CatalogConsumers1860000000000'
  async up(runner: QueryRunner) {
    await runner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist;
      CREATE TABLE contrast_protocols (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid,
        exam_type_id uuid NOT NULL,modality varchar(10) NOT NULL,family_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
        state_version integer NOT NULL DEFAULT 0,status varchar(20) NOT NULL CHECK(status IN ('DRAFT','ACTIVE','RETIRED')),
        name varchar(180) NOT NULL,template text NOT NULL,fields jsonb NOT NULL,notes varchar(2000) NOT NULL DEFAULT '',
        approval_reference varchar(500),approved_by_physician_id uuid REFERENCES physicians(id),activated_at timestamptz,
        created_by_user_id uuid NOT NULL REFERENCES auth_users(id),created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(id,company_id),UNIQUE(family_id,version),
        FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id),
        FOREIGN KEY(exam_type_id,company_id,modality) REFERENCES exam_types(id,company_id,modality),
        CHECK(status <> 'ACTIVE' OR (approval_reference IS NOT NULL AND approved_by_physician_id IS NOT NULL AND activated_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX contrast_protocol_active_family ON contrast_protocols(family_id) WHERE status='ACTIVE';
      CREATE TABLE prescription_protocol_selections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,exam_id uuid NOT NULL,protocol_id uuid NOT NULL,
        snapshot jsonb NOT NULL,created_by_user_id uuid NOT NULL REFERENCES auth_users(id),created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id),FOREIGN KEY(protocol_id,company_id) REFERENCES contrast_protocols(id,company_id)
      );
      CREATE TABLE exam_price_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid,physician_id uuid REFERENCES physicians(id),
        exam_type_id uuid NOT NULL,modality varchar(10) NOT NULL,kind varchar(10) NOT NULL CHECK(kind IN ('BILLING','PAYOUT')),
        currency varchar(3) NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),amount_cents bigint NOT NULL CHECK(amount_cents>=0 AND amount_cents<=99999999999),
        valid_from date NOT NULL,valid_to date,version integer NOT NULL DEFAULT 0,reason varchar(500) NOT NULL,
        created_by_user_id uuid NOT NULL REFERENCES auth_users(id),created_at timestamptz NOT NULL DEFAULT now(),
        CHECK(valid_to IS NULL OR valid_to>=valid_from),CHECK(kind='PAYOUT' OR physician_id IS NULL),
        FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id),
        FOREIGN KEY(exam_type_id,company_id,modality) REFERENCES exam_types(id,company_id,modality),
        EXCLUDE USING gist (company_id WITH =,exam_type_id WITH =,kind WITH =,
          (COALESCE(unit_id,'00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
          (COALESCE(physician_id,'00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
          daterange(valid_from,valid_to,'[]') WITH &&)
      );`)
    const old = (await runner.query('SELECT code FROM access_permissions')) as Array<{
      code: string
    }>
    const existing = new Set(old.map((entry) => entry.code))
    for (const permission of permissionCatalog)
      await runner.query(
        'INSERT INTO access_permissions(code,group_name,name) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING',
        [permission.code, permission.group, permission.name],
      )
    for (const [role, permissions] of Object.entries(defaultRolePermissions))
      for (const code of permissions)
        if (!existing.has(code))
          await runner.query(
            'INSERT INTO access_role_permissions(role_id,permission_code) SELECT id,$2 FROM access_roles WHERE code=$1 ON CONFLICT DO NOTHING',
            [role, code],
          )
  }
  async down(runner: QueryRunner) {
    const [used] = (await runner.query(
      'SELECT ((SELECT COUNT(*) FROM contrast_protocols)+(SELECT COUNT(*) FROM exam_price_rules))::int AS count',
    )) as Array<{ count: number }>
    if (used?.count)
      throw new Error(
        'Protocolos ou preços em uso: restaure o backup e concilie o histórico antes do rollback.',
      )
    await runner.query(
      'DROP TABLE prescription_protocol_selections; DROP TABLE contrast_protocols; DROP TABLE exam_price_rules;',
    )
  }
}
