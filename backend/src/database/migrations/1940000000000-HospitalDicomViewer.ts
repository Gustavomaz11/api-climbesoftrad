import type { MigrationInterface, QueryRunner } from 'typeorm'

export class HospitalDicomViewer1940000000000 implements MigrationInterface {
  name = 'HospitalDicomViewer1940000000000'
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE upload_sessions ADD COLUMN preview_orthanc_id varchar(64);
      ALTER TABLE dicom_viewer_grants ADD COLUMN intake_id uuid REFERENCES hospital_intakes(id),
        ADD COLUMN upload_ids uuid[] NOT NULL DEFAULT '{}';`)
  }
  async down(runner: QueryRunner) {
    await runner.query(`DELETE FROM dicom_viewer_grants WHERE intake_id IS NOT NULL;
      ALTER TABLE dicom_viewer_grants DROP COLUMN intake_id,DROP COLUMN upload_ids;
      ALTER TABLE upload_sessions DROP COLUMN preview_orthanc_id;`)
  }
}
