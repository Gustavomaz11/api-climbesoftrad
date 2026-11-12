import type { MigrationInterface, QueryRunner } from 'typeorm'

export class HospitalDeliveryIndexes1980000000000 implements MigrationInterface {
  name = 'HospitalDeliveryIndexes1980000000000'
  async up(runner: QueryRunner) {
    await runner.query(`CREATE INDEX upload_sessions_hospital_delivery ON upload_sessions(company_id,(payload->>'deliveryId'),unit_id) WHERE payload->>'deliveryId' IS NOT NULL;
      CREATE INDEX upload_sessions_hospital_pending ON upload_sessions(company_id,unit_id,status) WHERE payload->>'hospitalIntake'='true' AND payload->>'deliveryId' IS NULL;`)
  }
  async down(runner: QueryRunner) {
    await runner.query(
      'DROP INDEX upload_sessions_hospital_pending; DROP INDEX upload_sessions_hospital_delivery;',
    )
  }
}
