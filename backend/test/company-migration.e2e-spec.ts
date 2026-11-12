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

describe('Company migration on isolated legacy schemas (e2e)', () => {
  let runner: QueryRunner
  const originalMapping = process.env.LEGACY_COMPANY_NAME
  const migration = new CompanyAccess1820000000000()
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

  it('migrates a fresh installation and safely rolls back before operational use', async () => {
    delete process.env.LEGACY_COMPANY_NAME
    await migration.up(runner)
    expect(await rows<{ id: string; name: string }>('SELECT id, name FROM companies')).toEqual([
      { id: initialCompanyId, name: 'Sourad' },
    ])
    await migration.down(runner)
    const [columns] = await rows<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'hospital_units' AND column_name = 'company_id'",
    )
    expect(columns?.count).toBe('0')
  })

  it('requires confirmed ownership before touching a populated legacy schema', async () => {
    await runner.query("INSERT INTO hospital_units(name) VALUES ('Legada')")
    delete process.env.LEGACY_COMPANY_NAME
    await expect(migration.up(runner)).rejects.toThrow('LEGACY_COMPANY_NAME')
    const [columns] = await rows<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'hospital_units' AND column_name = 'company_id'",
    )
    expect(columns?.count).toBe('0')
  })

  it('preserves records and a revoked physician membership with explicit Sourad ownership', async () => {
    const [unit] = await rows<{ id: string }>(
      "INSERT INTO hospital_units(name) VALUES ('Legada') RETURNING id",
    )
    if (!unit) throw new Error('Missing legacy unit')
    const [doctor] = await rows<{ id: string }>(
      "INSERT INTO auth_users(email, full_name, password_hash, role, status, access_role_id) SELECT 'legacy@migration.test', 'Médico legado', 'test-hash', 'DOCTOR', 'DISABLED', id FROM access_roles WHERE code = 'DOCTOR' RETURNING id",
    )
    if (!doctor) throw new Error('Missing legacy doctor')
    await runner.query(
      "INSERT INTO exams(patient_name, sex, birth_date, country, study_description, modality, unit_id, priority, performed_at, created_by_user_id) VALUES ('Teste','FEMININO','1990-01-01','Brasil','Teste','CT',$1,'ROTINA',NOW(),$2)",
      [unit.id, doctor.id],
    )
    process.env.LEGACY_COMPANY_NAME = 'Sourad'
    await migration.up(runner)
    expect(
      await rows<{ company_id: string }>('SELECT company_id FROM hospital_units WHERE id = $1', [
        unit.id,
      ]),
    ).toEqual([{ company_id: initialCompanyId }])
    expect(await rows<{ company_id: string }>('SELECT company_id FROM exams')).toEqual([
      { company_id: initialCompanyId },
    ])
    expect(
      await rows<{ active: boolean; all_units: boolean }>(
        'SELECT active, all_units FROM company_memberships WHERE user_id = $1',
        [doctor.id],
      ),
    ).toEqual([{ active: false, all_units: true }])
    expect(
      await rows<{ status: string }>('SELECT status FROM auth_users WHERE id = $1', [doctor.id]),
    ).toEqual([{ status: 'ACTIVE' }])
    await migration.down(runner)
    expect(
      await rows<{ status: string }>('SELECT status FROM auth_users WHERE id = $1', [doctor.id]),
    ).toEqual([{ status: 'DISABLED' }])
  })

  it('preserves deliberately removed permissions on existing roles', async () => {
    await runner.query(`DELETE FROM access_role_permissions grants USING access_roles roles
      WHERE grants.role_id = roles.id AND roles.code = 'DOCTOR' AND grants.permission_code = 'reports.edit'`)
    process.env.LEGACY_COMPANY_NAME = 'Sourad'
    await migration.up(runner)
    expect(
      await rows<{ permission_code: string }>(
        `SELECT grants.permission_code FROM access_role_permissions grants JOIN access_roles roles ON roles.id = grants.role_id WHERE roles.code = 'DOCTOR' AND grants.permission_code = 'reports.edit'`,
      ),
    ).toHaveLength(0)
  })

  it('blocks destructive rollback once multiple companies exist', async () => {
    process.env.LEGACY_COMPANY_NAME = 'Sourad'
    await migration.up(runner)
    await runner.query("INSERT INTO companies(name) VALUES ('Outra Empresa')")
    await expect(migration.down(runner)).rejects.toThrow('restauração do backup')
  })
})
