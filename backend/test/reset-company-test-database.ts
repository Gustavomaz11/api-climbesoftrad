import type { DataSource } from 'typeorm'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'

export async function resetCompanyTestDatabase(database: DataSource) {
  const [current] = await database.query<Array<{ name: string }>>(
    'SELECT current_database() AS name',
  )
  if (!current?.name.endsWith('_test')) throw new Error('Limpeza permitida somente em banco _test.')
  await database.query(`
    TRUNCATE auth_security_events, auth_refresh_tokens, auth_sessions,
      oauth_authorization_codes, auth_users, oauth_clients, exams,
      company_settings_revisions, operational_events, hospital_units, patients, patient_identifiers, patient_encounters, patient_reviews, patient_link_decisions, patient_import_batches, patient_import_rows, exam_types, exam_type_aliases, exam_comparatives, exam_modalities CASCADE;
    DELETE FROM access_roles WHERE company_id <> '00000000-0000-4000-8000-000000000001' OR code LIKE 'CUSTOM_%';
    DELETE FROM companies WHERE id <> '00000000-0000-4000-8000-000000000001';
    UPDATE companies SET active = TRUE WHERE id = '00000000-0000-4000-8000-000000000001';
    INSERT INTO oauth_clients (client_id, display_name) VALUES ('crm-web', 'HealthCRM Web');
  `)
  await database.query('UPDATE access_roles SET active = TRUE WHERE company_id = $1', [
    initialCompanyId,
  ])
}
