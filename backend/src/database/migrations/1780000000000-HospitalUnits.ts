import type { MigrationInterface, QueryRunner } from 'typeorm'

export class HospitalUnits1780000000000 implements MigrationInterface {
  name = 'HospitalUnits1780000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE hospital_units (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name CITEXT NOT NULL UNIQUE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO hospital_units (name)
      SELECT DISTINCT TRIM(unit)
      FROM exams
      WHERE TRIM(unit) <> ''
      ORDER BY TRIM(unit);

      ALTER TABLE exams ADD COLUMN unit_id UUID;
      UPDATE exams
      SET unit_id = hospital_units.id
      FROM hospital_units
      WHERE hospital_units.name = TRIM(exams.unit);
      ALTER TABLE exams ALTER COLUMN unit_id SET NOT NULL;
      ALTER TABLE exams
        ADD CONSTRAINT exams_unit_fk
        FOREIGN KEY (unit_id) REFERENCES hospital_units(id) ON DELETE RESTRICT;
      CREATE INDEX idx_exams_unit_id ON exams(unit_id);
      ALTER TABLE exams DROP COLUMN unit;
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE exams ADD COLUMN unit VARCHAR(120);
      UPDATE exams
      SET unit = hospital_units.name
      FROM hospital_units
      WHERE exams.unit_id = hospital_units.id;
      ALTER TABLE exams ALTER COLUMN unit SET NOT NULL;
      ALTER TABLE exams DROP CONSTRAINT exams_unit_fk;
      DROP INDEX idx_exams_unit_id;
      ALTER TABLE exams DROP COLUMN unit_id;
      DROP TABLE hospital_units;
    `)
  }
}
