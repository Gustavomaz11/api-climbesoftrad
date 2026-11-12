import { PatientIdentificationCatalog1830000000000 } from '../src/database/migrations/1830000000000-PatientIdentificationCatalog'
import { randomUUID } from 'node:crypto'
import type { QueryRunner } from 'typeorm'
import database from '../src/database/data-source'
import { CompanyAccess1820000000000 } from '../src/database/migrations/1820000000000-CompanyAccess'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { AuthSchema1710000000000 } from '../src/database/migrations/1710000000000-AuthSchema'
import { ExamsSchema1720000000000 } from '../src/database/migrations/1720000000000-ExamsSchema'
import { UserRoles1730000000000 } from '../src/database/migrations/1730000000000-UserRoles'
import { ExamReportPresence1740000000000 } from '../src/database/migrations/1740000000000-ExamReportPresence'
import { ExamComments1750000000000 } from '../src/database/migrations/1750000000000-ExamComments'
import { Physicians1760000000000 } from '../src/database/migrations/1760000000000-Physicians'
import { MedicalSpecialties1770000000000 } from '../src/database/migrations/1770000000000-MedicalSpecialties'
import { HospitalUnits1780000000000 } from '../src/database/migrations/1780000000000-HospitalUnits'
import { AccountDisabledRevocationReason1790000000000 } from '../src/database/migrations/1790000000000-AccountDisabledRevocationReason'
import { AccessControl1800000000000 } from '../src/database/migrations/1800000000000-AccessControl'
import { NormalizeAccessControlLabels1810000000000 } from '../src/database/migrations/1810000000000-NormalizeAccessControlLabels'

describe('Patient migration on isolated schemas (e2e)', () => {
  let runner: QueryRunner
  const originalMapping = process.env.LEGACY_COMPANY_NAME
  const migration = new PatientIdentificationCatalog1830000000000()
  beforeAll(async () => {
    await database.initialize()
    const [current] = await database.query<Array<{ name: string }>>(
      'SELECT current_database() AS name',
    )
    if (!current?.name.endsWith('_test'))
      throw new Error('Migration tests require a _test database.')
  })
  beforeEach(async () => {
    runner = database.createQueryRunner()
    await runner.connect()
    await runner.startTransaction()
    const schema = 'migration_test_' + randomUUID().replaceAll('-', '')
    await runner.query('CREATE SCHEMA ' + schema)
    await runner.query('SET LOCAL search_path TO ' + schema + ', public')
    for (const previous of [
      new AuthSchema1710000000000(),
      new ExamsSchema1720000000000(),
      new UserRoles1730000000000(),
      new ExamReportPresence1740000000000(),
      new ExamComments1750000000000(),
      new Physicians1760000000000(),
      new MedicalSpecialties1770000000000(),
      new HospitalUnits1780000000000(),
      new AccountDisabledRevocationReason1790000000000(),
      new AccessControl1800000000000(),
      new NormalizeAccessControlLabels1810000000000(),
    ])
      await previous.up(runner)
    process.env.LEGACY_COMPANY_NAME = 'Sourad'
    await new CompanyAccess1820000000000().up(runner)
  }, 30000)
  afterEach(async () => {
    if (originalMapping === undefined) delete process.env.LEGACY_COMPANY_NAME
    else process.env.LEGACY_COMPANY_NAME = originalMapping
    await runner.rollbackTransaction()
    await runner.release()
  })
  afterAll(async () => {
    await database.destroy()
  })
  const rows = <T>(sql: string, parameters?: unknown[]) =>
    runner.query(sql, parameters) as Promise<T[]>

  it('installs an empty schema and allows rollback before operational use', async () => {
    await migration.up(runner)
    expect(await rows('SELECT id FROM patients')).toHaveLength(0)
    await migration.down(runner)
    const [table] = await rows<{ name: string | null }>(
      "SELECT to_regclass(current_schema()||'.patients')::text AS name",
    )
    expect(table?.name).toBeNull()
  })
  it('preserves every legacy exam and keeps homonyms and unverified IDs separate', async () => {
    const [unit] = await rows<{ id: string }>(
      "INSERT INTO hospital_units(company_id,name) VALUES ($1,'Legada Identificação') RETURNING id",
      [initialCompanyId],
    )
    const [user] = await rows<{ id: string }>(
      "INSERT INTO auth_users(email,full_name,password_hash,role,status,access_role_id) SELECT 'patient.migration@test.local','Operador Migração','fixture','ADMIN','ACTIVE',id FROM access_roles WHERE company_id=$1 AND code='ADMINISTRATOR' RETURNING id",
      [initialCompanyId],
    )
    const received = await rows<{ id: string }>(
      "INSERT INTO exams(company_id,unit_id,patient_name,sex,birth_date,identity,country,study_description,modality,priority,performed_at,created_by_user_id) VALUES ($1,$2,'João da Silva','MASCULINO','1990-01-01','000123','Brasil','Descrição Original','CT','ROTINA',NOW(),$3),($1,$2,'João da Silva','MASCULINO','1990-01-01','000123','Brasil','Descrição Original','CT','ROTINA',NOW(),$3) RETURNING id",
      [initialCompanyId, unit?.id, user?.id],
    )
    await migration.up(runner)
    const patients = await rows<{ id: string; normalized_name: string }>(
      'SELECT id,normalized_name FROM patients',
    )
    expect(patients).toHaveLength(2)
    expect(patients.map((p) => p.id).sort()).toEqual(received.map((e) => e.id).sort())
    expect(patients.every((p) => p.normalized_name === 'joao da silva')).toBe(true)
    expect(await rows('SELECT id FROM patient_identifiers')).toHaveLength(0)
    const exams = await rows<{
      id: string
      patient_id: string
      encounter_id: string
      patient_identity_status: string
      received_patient_data: { identity: string; fullName: string }
      study_description: string
    }>(
      'SELECT id,patient_id,encounter_id,patient_identity_status,received_patient_data,study_description FROM exams',
    )
    for (const exam of exams) {
      expect(exam.patient_id).toBe(exam.id)
      expect(exam.encounter_id).toBe(exam.id)
      expect(exam.patient_identity_status).toBe('LEGACY')
      expect(exam.received_patient_data).toMatchObject({
        fullName: 'João da Silva',
        identity: '000123',
      })
      expect(exam.study_description).toBe('Descrição Original')
    }
    expect(
      await rows("SELECT id FROM patient_reviews WHERE kind='LEGACY' AND status='OPEN'"),
    ).toHaveLength(2)
    await migration.down(runner)
    expect(await rows('SELECT id FROM exams')).toHaveLength(2)
  })
  it('refuses rollback after catalog or identity operations', async () => {
    await migration.up(runner)
    await runner.query(
      "INSERT INTO exam_types(company_id,name,modality,group_name) VALUES ($1,'Tipo Teste','CT','Grupo Teste')",
      [initialCompanyId],
    )
    await expect(migration.down(runner)).rejects.toThrow('Restaurar backup')
  })
})
