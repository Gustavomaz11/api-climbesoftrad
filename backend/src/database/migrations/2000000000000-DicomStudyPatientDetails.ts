import type { MigrationInterface, QueryRunner } from 'typeorm'

export class DicomStudyPatientDetails2000000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE exams
      ADD COLUMN height_meters double precision,
      ADD COLUMN weight_kg double precision,
      ADD COLUMN study_date date,
      ADD COLUMN study_time varchar(16),
      ADD COLUMN institution_name varchar(120),
      ADD COLUMN study_id varchar(64),
      ADD CONSTRAINT exam_height_valid CHECK (height_meters IS NULL OR (height_meters>0 AND height_meters<=10)),
      ADD CONSTRAINT exam_weight_valid CHECK (weight_kg IS NULL OR (weight_kg>0 AND weight_kg<=10000))`)
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE exams DROP CONSTRAINT exam_height_valid, DROP CONSTRAINT exam_weight_valid,
      DROP COLUMN height_meters, DROP COLUMN weight_kg, DROP COLUMN study_date,
      DROP COLUMN study_time, DROP COLUMN institution_name, DROP COLUMN study_id`)
  }
}
