import type { MigrationInterface, QueryRunner } from 'typeorm'
export class ArchiveRetries1880000000000 implements MigrationInterface {
  name = 'ArchiveRetries1880000000000'
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE dicom_instances ADD COLUMN archive_attempts integer NOT NULL DEFAULT 0 CHECK(archive_attempts>=0),ADD COLUMN archive_retry_at timestamptz;
      ALTER TABLE stored_objects ADD CONSTRAINT stored_objects_id_company_unique UNIQUE(id,company_id);
      ALTER TABLE dicom_instances ADD CONSTRAINT dicom_instances_object_company_fk FOREIGN KEY(object_id,company_id) REFERENCES stored_objects(id,company_id);`)
  }
  async down(runner: QueryRunner) {
    const [used] = (await runner.query(
      'SELECT COUNT(*)::int AS count FROM dicom_instances',
    )) as Array<{ count: number }>
    if (used?.count)
      throw new Error('Instâncias DICOM preservadas: concilie a fila antes do rollback.')
    await runner.query(
      'ALTER TABLE dicom_instances DROP CONSTRAINT dicom_instances_object_company_fk;ALTER TABLE stored_objects DROP CONSTRAINT stored_objects_id_company_unique;ALTER TABLE dicom_instances DROP COLUMN archive_retry_at,DROP COLUMN archive_attempts;',
    )
  }
}
