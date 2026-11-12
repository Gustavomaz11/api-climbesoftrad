import type { MigrationInterface, QueryRunner } from 'typeorm'
import {
  defaultRolePermissions,
  permissionCatalog,
} from '../../modules/access-control/permission.catalog'

export class ImageIngestion1870000000000 implements MigrationInterface {
  name = 'ImageIngestion1870000000000'
  async up(runner: QueryRunner) {
    await runner.query(`
      ALTER TABLE stored_objects ALTER COLUMN exam_id DROP NOT NULL;
      ALTER TABLE exam_attachments DROP CONSTRAINT exam_attachments_validation_status_check;
      ALTER TABLE exam_attachments ADD CONSTRAINT exam_attachments_validation_status_check
        CHECK(validation_status IN ('SIGNATURE_VALIDATED','APPROVED','QUARANTINED','REJECTED'));
      CREATE TABLE dicom_sources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,
        name varchar(120) NOT NULL,token_hash varchar(64) NOT NULL UNIQUE,active boolean NOT NULL DEFAULT true,
        created_by_user_id uuid NOT NULL REFERENCES auth_users(id),last_seen_at timestamptz,
        diagnostics jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(id,unit_id,company_id),FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id)
      );
      CREATE TABLE upload_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,
        exam_id uuid,source_id uuid,kind varchar(20) NOT NULL CHECK(kind IN ('ATTACHMENT','DICOM')),
        name varchar(255) NOT NULL,content_type varchar(120) NOT NULL,size_bytes integer NOT NULL CHECK(size_bytes>0),
        sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),storage_key varchar(500) NOT NULL UNIQUE,
        multipart_id varchar(500) NOT NULL,status varchar(20) NOT NULL CHECK(status IN
          ('UPLOADING','RECEIVED','VALIDATING','APPROVED','QUARANTINED','REJECTED','PUBLISHED','CANCELLED','EXPIRED')),
        payload jsonb NOT NULL DEFAULT '{}',context jsonb NOT NULL,result_id uuid,validation_reason varchar(500),
        lease_until timestamptz,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(id,unit_id,company_id),FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id),
        FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id),
        FOREIGN KEY(source_id,unit_id,company_id) REFERENCES dicom_sources(id,unit_id,company_id),
        CHECK(kind<>'ATTACHMENT' OR exam_id IS NOT NULL)
      );
      CREATE INDEX upload_sessions_pending ON upload_sessions(status,expires_at);
      CREATE TABLE dicom_studies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,
        exam_id uuid NOT NULL,study_uid varchar(64) NOT NULL,identity_hash varchar(64) NOT NULL,
        last_received_at timestamptz NOT NULL,completed_at timestamptz,completion_reason varchar(100),
        created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,unit_id,study_uid),UNIQUE(id,unit_id,company_id),
        FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id),
        FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id)
      );
      CREATE TABLE dicom_series (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,
        study_id uuid NOT NULL,series_uid varchar(64) NOT NULL,modality varchar(10) NOT NULL,
        UNIQUE(company_id,unit_id,series_uid),UNIQUE(id,study_id,unit_id,company_id),
        FOREIGN KEY(study_id,unit_id,company_id) REFERENCES dicom_studies(id,unit_id,company_id)
      );
      CREATE TABLE dicom_instances (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,
        study_id uuid NOT NULL,series_id uuid NOT NULL,instance_uid varchar(64) NOT NULL,
        object_id uuid NOT NULL REFERENCES stored_objects(id),orthanc_id varchar(64),archive_error varchar(100),
        created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,unit_id,instance_uid),
        FOREIGN KEY(series_id,study_id,unit_id,company_id) REFERENCES dicom_series(id,study_id,unit_id,company_id)
      );
      CREATE TABLE dicom_reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,
        upload_id uuid NOT NULL,exam_id uuid,kind varchar(40) NOT NULL CHECK(kind IN ('DEMOGRAPHICS','IDENTITY_COLLISION','POSSIBLE_DUPLICATE')),
        details jsonb NOT NULL,status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
        version integer NOT NULL DEFAULT 0,resolved_by_user_id uuid REFERENCES auth_users(id),resolution_reason varchar(500),
        created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(upload_id,kind),
        FOREIGN KEY(upload_id,unit_id,company_id) REFERENCES upload_sessions(id,unit_id,company_id),
        FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id)
      );
      CREATE TABLE dicom_viewer_grants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash varchar(64) NOT NULL UNIQUE,
        context jsonb NOT NULL,study_ids uuid[] NOT NULL,expires_at timestamptz NOT NULL
      );
    `)
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
      'SELECT ((SELECT COUNT(*) FROM upload_sessions)+(SELECT COUNT(*) FROM dicom_sources))::int AS count',
    )) as Array<{ count: number }>
    if (used?.count) throw new Error('Ingestão em uso: preserve arquivos e fila antes do rollback.')
    await runner.query(`DROP TABLE dicom_viewer_grants,dicom_reviews,dicom_instances,dicom_series,dicom_studies,upload_sessions,dicom_sources;
      ALTER TABLE exam_attachments DROP CONSTRAINT exam_attachments_validation_status_check;
      ALTER TABLE exam_attachments ADD CONSTRAINT exam_attachments_validation_status_check CHECK(validation_status='SIGNATURE_VALIDATED');
      ALTER TABLE stored_objects ALTER COLUMN exam_id SET NOT NULL;`)
  }
}
