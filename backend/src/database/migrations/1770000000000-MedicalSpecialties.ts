import type { MigrationInterface, QueryRunner } from 'typeorm'

export class MedicalSpecialties1770000000000 implements MigrationInterface {
  name = 'MedicalSpecialties1770000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE medical_specialties (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name CITEXT NOT NULL UNIQUE,
        display_order INTEGER NOT NULL UNIQUE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        source_reference VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO medical_specialties (name, display_order, source_reference) VALUES
        ('Acupuntura', 1, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Alergia e Imunologia', 2, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Anestesiologia', 3, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Angiologia', 4, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cardiologia', 5, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia Cardiovascular', 6, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia da Mão', 7, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia de Cabeça e Pescoço', 8, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia do Aparelho Digestivo', 9, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia Geral', 10, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia Oncológica', 11, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia Pediátrica', 12, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia Plástica', 13, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia Torácica', 14, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Cirurgia Vascular', 15, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Clínica Médica', 16, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Coloproctologia', 17, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Dermatologia', 18, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Endocrinologia e Metabologia', 19, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Endoscopia', 20, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Gastroenterologia', 21, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Genética Médica', 22, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Geriatria', 23, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Ginecologia e Obstetrícia', 24, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Hematologia e Hemoterapia', 25, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Homeopatia', 26, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Infectologia', 27, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Mastologia', 28, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina de Emergência', 29, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina de Família e Comunidade', 30, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina do Trabalho', 31, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina do Tráfego', 32, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina Esportiva', 33, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina Física e Reabilitação', 34, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina Intensiva', 35, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina Legal e Perícia Médica', 36, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina Nuclear', 37, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Medicina Preventiva e Social', 38, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Nefrologia', 39, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Neurocirurgia', 40, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Neurologia', 41, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Nutrologia', 42, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Oftalmologia', 43, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Oncologia Clínica', 44, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Ortopedia e Traumatologia', 45, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Otorrinolaringologia', 46, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Patologia', 47, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Patologia Clínica/Medicina Laboratorial', 48, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Pediatria', 49, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Pneumologia', 50, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Psiquiatria', 51, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Radiologia e Diagnóstico por Imagem', 52, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Radioterapia', 53, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Reumatologia', 54, 'CFM/CME - Resolução CFM nº 2.380/2024'),
        ('Urologia', 55, 'CFM/CME - Resolução CFM nº 2.380/2024');

      WITH legacy_specialties AS (
        SELECT DISTINCT TRIM(specialty) AS name
        FROM physicians
        WHERE NOT EXISTS (
          SELECT 1 FROM medical_specialties current_specialty
          WHERE current_specialty.name = TRIM(physicians.specialty)
        )
      )
      INSERT INTO medical_specialties (name, display_order, active, source_reference)
      SELECT name, 1000 + ROW_NUMBER() OVER (ORDER BY name), FALSE, 'Cadastro anterior à lista oficial'
      FROM legacy_specialties;

      ALTER TABLE physicians ADD COLUMN specialty_id UUID;
      UPDATE physicians
      SET specialty_id = medical_specialties.id
      FROM medical_specialties
      WHERE medical_specialties.name = TRIM(physicians.specialty);
      ALTER TABLE physicians ALTER COLUMN specialty_id SET NOT NULL;
      ALTER TABLE physicians
        ADD CONSTRAINT physicians_specialty_fk
        FOREIGN KEY (specialty_id) REFERENCES medical_specialties(id) ON DELETE RESTRICT;
      CREATE INDEX idx_physicians_specialty_id ON physicians(specialty_id);
      ALTER TABLE physicians DROP COLUMN specialty;
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE physicians ADD COLUMN specialty VARCHAR(120);
      UPDATE physicians
      SET specialty = medical_specialties.name
      FROM medical_specialties
      WHERE physicians.specialty_id = medical_specialties.id;
      ALTER TABLE physicians ALTER COLUMN specialty SET NOT NULL;
      ALTER TABLE physicians DROP CONSTRAINT physicians_specialty_fk;
      DROP INDEX idx_physicians_specialty_id;
      ALTER TABLE physicians DROP COLUMN specialty_id;
      DROP TABLE medical_specialties;
    `)
  }
}
