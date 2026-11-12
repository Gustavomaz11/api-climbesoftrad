import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ExamsSchema1720000000000 implements MigrationInterface {
  name = 'ExamsSchema1720000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE exams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_name VARCHAR(120) NOT NULL,
        social_name VARCHAR(120),
        sex VARCHAR(10) NOT NULL CHECK (sex IN ('MASCULINO', 'FEMININO')),
        birth_date DATE NOT NULL,
        identity VARCHAR(80),
        country VARCHAR(80) NOT NULL DEFAULT 'Brasil',
        email CITEXT,
        study_description VARCHAR(180) NOT NULL,
        code VARCHAR(60),
        accession_number VARCHAR(80),
        order_code VARCHAR(80),
        modality VARCHAR(10) NOT NULL CHECK (
          modality IN ('MR', 'CT', 'CR', 'DX', 'US', 'MG', 'OT', 'XA', 'CP', 'NM', 'ES', 'EEG', 'ECG', 'BMD')
        ),
        unit VARCHAR(120) NOT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'ROTINA' CHECK (
          priority IN ('IMEDIATA', 'PRIORITARIA', 'EMERGENCIA', 'URGENTE', 'ALTA', 'ROTINA')
        ),
        requester_reference VARCHAR(140),
        requester_name VARCHAR(120),
        performing_physician VARCHAR(120),
        health_insurance VARCHAR(100),
        performed_at TIMESTAMPTZ NOT NULL,
        auxiliary_field_1 VARCHAR(160),
        auxiliary_field_2 VARCHAR(160),
        created_by_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_exams_performed_at ON exams(performed_at DESC);
      CREATE INDEX idx_exams_patient_name ON exams(LOWER(patient_name));
      CREATE INDEX idx_exams_created_by_user ON exams(created_by_user_id);
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS exams;')
  }
}
