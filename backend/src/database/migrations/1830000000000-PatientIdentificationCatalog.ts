import type { MigrationInterface, QueryRunner } from 'typeorm'
import { patientCatalogSchema } from './schema/patient-catalog-schema'
import {
  permissionCatalog,
  defaultRolePermissions,
} from '../../modules/access-control/permission.catalog'
export class PatientIdentificationCatalog1830000000000 implements MigrationInterface {
  name = 'PatientIdentificationCatalog1830000000000'
  async up(runner: QueryRunner) {
    await runner.query(patientCatalogSchema)
    await runner.query(`INSERT INTO patients(id,company_id,full_name,normalized_name,social_name,birth_date,sex,country,email,created_at,updated_at) SELECT id,company_id,patient_name,patient_name,social_name,birth_date,sex,country,email,created_at,updated_at FROM exams;
    INSERT INTO patient_units(patient_id,unit_id,company_id) SELECT id,unit_id,company_id FROM exams;
    INSERT INTO patient_encounters(id,company_id,unit_id,patient_id,performed_at) SELECT id,company_id,unit_id,id,performed_at FROM exams;
    UPDATE exams SET patient_id=id,encounter_id=id,received_patient_data=jsonb_build_object('fullName',patient_name,'socialName',social_name,'birthDate',birth_date,'sex',sex,'identity',identity,'country',country,'email',email);
    INSERT INTO patient_revisions(company_id,patient_id,version,demographics,reason,actor_user_id) SELECT company_id,id,0,received_patient_data,'Migração conservadora sem emissor de identificador confirmado',created_by_user_id FROM exams;
    INSERT INTO patient_reviews(company_id,unit_id,patient_id,exam_id,kind) SELECT company_id,unit_id,id,id,'LEGACY' FROM exams;
    SET CONSTRAINTS ALL IMMEDIATE;
    ALTER TABLE exams ALTER COLUMN patient_id SET NOT NULL,ALTER COLUMN encounter_id SET NOT NULL;
    SET CONSTRAINTS ALL DEFERRED;
  `)
    await runner.query(
      `UPDATE patients SET normalized_name=btrim(regexp_replace(lower(regexp_replace(normalize(full_name,NFKD),'[\u0300-\u036f]','','g')),'[^[:alnum:]]+',' ','g'))`,
    )
    const old = (await runner.query('SELECT code FROM access_permissions')) as Array<{
      code: string
    }>
    const existing = new Set(old.map((item) => item.code))
    for (const permission of permissionCatalog)
      await runner.query(
        'INSERT INTO access_permissions(code,group_name,name) VALUES ($1,$2,$3) ON CONFLICT(code) DO UPDATE SET group_name=EXCLUDED.group_name,name=EXCLUDED.name',
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
      `SELECT ((SELECT COUNT(*) FROM patients WHERE revision>0 OR merged_into_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM exams WHERE exams.id=patients.id))+(SELECT COUNT(*) FROM patient_reviews WHERE status<>'OPEN')+(SELECT COUNT(*) FROM operational_events WHERE action LIKE 'PATIENT_%' OR action LIKE 'EXAM_TYPE_%' OR action='EXAM_CLASSIFICATION_REVIEWED')+(SELECT COUNT(*) FROM patient_identifiers)+(SELECT COUNT(*) FROM exam_types)+(SELECT COUNT(*) FROM patient_import_batches)+(SELECT COUNT(*) FROM exam_comparatives)+(SELECT COUNT(*) FROM exams WHERE patient_identity_status<>'LEGACY'))::int AS count`,
    )) as Array<{ count: number }>
    if (used?.count)
      throw new Error(
        'Restaurar backup e conciliar dados: a identificação de pacientes já foi utilizada.',
      )
    await runner.query(`SET CONSTRAINTS ALL IMMEDIATE; DROP TABLE patient_import_rows;DROP TABLE patient_import_batches;DROP TABLE exam_comparatives;
    ALTER TABLE exams DROP COLUMN patient_id,DROP COLUMN encounter_id,DROP COLUMN patient_identifier_id,DROP COLUMN patient_link_decision_id,DROP COLUMN patient_identity_status,DROP COLUMN received_patient_data,DROP COLUMN origin_issuer,DROP COLUMN external_patient_id,DROP COLUMN source_exam_id,DROP COLUMN source_payload_hash,DROP COLUMN exam_type_id,DROP COLUMN normalization_status,DROP COLUMN normalization_alias_id,DROP COLUMN normalization_rule_version;
    ALTER TABLE patient_reviews DROP CONSTRAINT patient_review_exam_company;
    ALTER TABLE exams DROP CONSTRAINT exams_id_company;
    DROP TABLE exam_type_aliases;DROP TABLE exam_types;
    ALTER TABLE patient_reviews DROP COLUMN decision_id;
    DROP TABLE patient_identifiers;DROP TABLE patient_encounters;DROP TABLE patient_link_decisions;DROP TABLE patient_reviews;DROP TABLE patient_revisions;DROP TABLE patient_units;DROP TABLE patients;`)
  }
}
