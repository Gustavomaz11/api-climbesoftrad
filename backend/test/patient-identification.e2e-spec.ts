import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import cookieParser from 'cookie-parser'
import { createHash, randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import request, { type Response } from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { AdminAccountProvisioner } from '../src/modules/auth/admin-account.provisioner'
import { R2ObjectStorage } from '../src/modules/exams/r2-object-storage.service'
import { OperationalAuditService } from '../src/modules/companies/operational-audit.service'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { resetCompanyTestDatabase } from './reset-company-test-database'
const body = <T>(response: Response) => response.body as T
interface Exam {
  id: string
  patientId: string
  encounterId: string
  patientIdentityStatus: string
  normalizationStatus: string
  examTypeId: string | null
  updatedAt: string
}
interface Patient {
  id: string
  revision: number
  fullName: string
}
interface Review {
  id: string
  version: number
  patientId: string
  patient: { revision: number }
  candidates: Array<{ patientId: string }>
}
interface ImportReport {
  batch: { id: string }
  rows: Array<{ id: string; version: number; status: string; included: boolean }>
  counts: Record<string, number>
}
describe('Patient identification, review, imports and exam catalog (e2e)', () => {
  let app: INestApplication,
    server: Server,
    database: DataSource,
    token: string,
    unit: string,
    secondUnit: string,
    otherCompany: string,
    otherUnit: string
  const objects = new Map<string, string>()
  const storage = {
    readText: jest.fn((key: string) => Promise.resolve(objects.get(key) ?? null)),
    put: jest.fn((key: string, input: { body: string | Buffer }) => {
      objects.set(key, input.body.toString())
      return Promise.resolve()
    }),
    delete: jest.fn((key: string) => {
      objects.delete(key)
      return Promise.resolve()
    }),
    signedGetUrl: jest.fn((key: string) => Promise.resolve('https://objects.example.test/' + key)),
  }
  const api = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    company = initialCompanyId,
  ) =>
    request(server)
      [method]('/api/v1' + path)
      .set('Authorization', 'Bearer ' + token)
      .set('X-Company-Id', company)
  const patient = async (name: string, unitId = unit, company = initialCompanyId) =>
    body<Patient>(
      await api('post', '/patients', company)
        .send({
          fullName: name,
          birthDate: '1990-01-01',
          sex: 'FEMININO',
          country: 'Brasil',
          unitId,
        })
        .expect(201),
    )
  const exam = async (values: Record<string, unknown> = {}, company = initialCompanyId) =>
    body<Exam>(
      await api('post', '/exams', company)
        .send({
          patientName: 'Maria Identificação',
          birthDate: '1990-01-01',
          sex: 'FEMININO',
          country: 'Brasil',
          unitId: unit,
          studyDescription: 'Estudo não mapeado',
          modality: 'CT',
          priority: 'ROTINA',
          performedAt: '2026-10-13T12:00:00Z',
          ...values,
        })
        .expect(201),
    )
  const reviews = async () => body<Review[]>(await api('get', '/patient-reviews').expect(200))
  const csv = (rows: string[]) =>
    'unitId;issuer;externalId;patientId;legacyIssuer;legacyExternalId\n' + rows.join('\n')
  const preview = async (text: string) =>
    body<ImportReport>(
      await api('post', '/patient-imports')
        .attach('file', Buffer.from(text), { filename: 'mapeamento.csv', contentType: 'text/csv' })
        .expect(201),
    )
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2ObjectStorage)
      .useValue(storage)
      .compile()
    app = module.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    app.setGlobalPrefix('api/v1')
    await app.init()
    server = app.getHttpServer() as Server
    database = app.get(DataSource)
    await resetCompanyTestDatabase(database)
    await app.get(AdminAccountProvisioner).ensureAdmin()
    const config = app.get(ConfigService)
    const verifier = randomBytes(64).toString('base64url')
    const authorization = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: config.getOrThrow<string>('ADMIN_EMAIL'),
        password: config.getOrThrow<string>('ADMIN_PASSWORD'),
        clientId: 'crm-web',
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
        codeChallengeMethod: 'S256',
        state: randomBytes(32).toString('base64url'),
        remember: false,
      })
      .expect(200)
    const exchange = await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        grantType: 'authorization_code',
        clientId: 'crm-web',
        authorizationCode: body<{ authorizationCode: string }>(authorization).authorizationCode,
        codeVerifier: verifier,
      })
      .expect(200)
    token = body<{ accessToken: string }>(exchange).accessToken
    unit = body<{ id: string }>(
      await api('post', '/hospital-units').send({ name: 'Unidade Identificação' }).expect(201),
    ).id
    secondUnit = body<{ id: string }>(
      await api('post', '/hospital-units').send({ name: 'Segunda Identificação' }).expect(201),
    ).id
    otherCompany = body<{ id: string }>(
      await api('post', '/companies').send({ name: 'Outra Empresa Identificação' }).expect(201),
    ).id
    otherUnit = body<{ id: string }>(
      await api('post', '/hospital-units', otherCompany)
        .send({ name: 'Unidade Identificação' })
        .expect(201),
    ).id
  }, 30000)
  afterAll(async () => {
    await app?.close()
  })
  it('reuses a trusted origin ID under concurrent exam ingestion without duplicate patients', async () => {
    const exams = await Promise.all([
      exam({
        originIssuer: 'MV',
        externalPatientId: '0001',
        sourceExamId: 'estudo-1',
        externalEncounterId: 'atendimento-1',
      }),
      exam({
        originIssuer: 'MV',
        externalPatientId: '0001',
        sourceExamId: 'estudo-2',
        externalEncounterId: 'atendimento-1',
      }),
    ])
    expect(exams[0]?.patientId).toBe(exams[1]?.patientId)
    expect(exams[0]?.encounterId).toBe(exams[1]?.encounterId)
    const patients = await database.query<Array<{ patient_id: string }>>(
      "SELECT patient_id FROM patient_identifiers WHERE issuer='MV' AND original_value='0001'",
    )
    expect(patients).toHaveLength(1)
  })
  it('returns the same exam on retry and rejects a conflicting source payload', async () => {
    const first = await exam({
      originIssuer: 'MV',
      externalPatientId: '0001',
      sourceExamId: 'idempotente',
    })
    const second = await exam({
      originIssuer: 'MV',
      externalPatientId: '0001',
      sourceExamId: 'idempotente',
    })
    expect(second.id).toBe(first.id)
    await api('post', '/exams')
      .send({
        patientName: 'Outra Pessoa',
        birthDate: '1990-01-01',
        sex: 'FEMININO',
        country: 'Brasil',
        unitId: unit,
        studyDescription: 'Estudo não mapeado',
        modality: 'CT',
        priority: 'ROTINA',
        performedAt: '2026-10-13T12:00:00Z',
        originIssuer: 'MV',
        externalPatientId: '0001',
        sourceExamId: 'idempotente',
      })
      .expect(409)
  })
  it('separates IDs from other emitters, units and companies even for homonyms', async () => {
    const first = await exam({ originIssuer: 'MV', externalPatientId: '0001' })
    const issuer = await exam({ originIssuer: 'Outro Sistema', externalPatientId: '0001' })
    const hospital = await exam({
      unitId: secondUnit,
      originIssuer: 'MV',
      externalPatientId: '0001',
    })
    const company = await exam(
      { unitId: otherUnit, originIssuer: 'MV', externalPatientId: '0001' },
      otherCompany,
    )
    expect(
      new Set([first.patientId, issuer.patientId, hospital.patientId, company.patientId]).size,
    ).toBe(4)
  })
  it('keeps missing IDs separate and produces explainable suggestions without auto merging', async () => {
    const known = await patient('João Sem Identificador')
    const received = await exam({ patientName: 'Joao Sem Identificador' })
    expect(received.patientId).not.toBe(known.id)
    expect(received.patientIdentityStatus).toBe('SUGGESTION')
    const review = (await reviews()).find((row) => row.patientId === received.patientId)
    expect(review?.candidates.some((c) => c.patientId === known.id)).toBe(true)
  })
  it('routes demographic conflicts to review while preserving both the known patient and received data', async () => {
    const known = await exam({
      originIssuer: 'SIGH',
      externalPatientId: 'conflito',
      patientName: 'Paciente Conhecido',
    })
    const conflict = await exam({
      originIssuer: 'SIGH',
      externalPatientId: 'conflito',
      patientName: 'Nome Divergente',
      birthDate: '1980-01-01',
    })
    expect(conflict.patientId).not.toBe(known.patientId)
    expect(conflict.patientIdentityStatus).toBe('CONFLICT')
    expect(
      body<Patient>(await api('get', '/patients/' + known.patientId).expect(200)).fullName,
    ).toBe('Paciente Conhecido')
    expect((await reviews()).some((r) => r.patientId === conflict.patientId)).toBe(true)
  })
  it('records demographic corrections without retroactively changing exam snapshots', async () => {
    const original = await exam({
      patientName: 'Nome Original',
      originIssuer: 'Cadastro',
      externalPatientId: 'snapshot',
    })
    const record = body<Patient>(await api('get', '/patients/' + original.patientId).expect(200))
    await api('put', '/patients/' + record.id)
      .send({
        fullName: 'Nome Corrigido',
        birthDate: '1990-01-01',
        sex: 'FEMININO',
        country: 'Brasil',
        expectedVersion: record.revision,
        reason: 'Conferência documental',
      })
      .expect(200)
    const [stored] = await database.query<
      Array<{ patient_name: string; received_patient_data: { fullName: string } }>
    >('SELECT patient_name,received_patient_data FROM exams WHERE id=$1', [original.id])
    expect(stored).toMatchObject({
      patient_name: 'Nome Original',
      received_patient_data: { fullName: 'Nome Original' },
    })
    await api('put', '/patients/' + record.id)
      .send({
        fullName: 'Outro Nome',
        country: 'Brasil',
        expectedVersion: 0,
        reason: 'Concorrência',
      })
      .expect(409)
  })
  it('approves and reverses an association, including exams received after the decision, preserving documents', async () => {
    const target = await patient('Paciente Destino')
    const source = await exam({
      patientName: 'Paciente de Origem',
      originIssuer: 'Legado',
      externalPatientId: 'reversivel',
      sourceExamId: 'reversivel-1',
      performedAt: '2026-10-02T12:00:00Z',
    })
    await api('post', '/patients/' + source.patientId + '/identifiers')
      .send({
        unitId: unit,
        issuer: 'Outra Origem',
        originalValue: 'alias',
        reason: 'Identificador conferido',
      })
      .expect(201)
    const noId = await exam({ patientId: source.patientId, patientName: 'Paciente de Origem' })
    const review = (await reviews()).find((r) => r.patientId === source.patientId)
    const selected = review ?? (await reviews()).find((r) => r.patientId === noId.patientId)
    if (!selected) throw Error('Review absent')
    const sourceVersion = body<Patient>(
      await api('get', '/patients/' + selected.patientId).expect(200),
    ).revision
    const decision = body<{ decisionId: string }>(
      await api('post', '/patient-reviews/' + selected.id + '/decision')
        .send({
          decision: 'APPROVE',
          targetPatientId: target.id,
          expectedVersion: selected.version,
          expectedSourceVersion: sourceVersion,
          expectedTargetVersion: target.revision,
          reason: 'Conferência da identidade',
        })
        .expect(201),
    )
    objects.set(
      'reports/' + source.id + '/report.json',
      JSON.stringify({ version: 1, examId: source.id, content: { type: 'doc' } }),
    )
    const after = await exam({
      patientName: 'Paciente Destino',
      originIssuer: 'Legado',
      externalPatientId: 'reversivel',
      sourceExamId: 'reversivel-2',
    })
    expect(after.patientId).toBe(target.id)
    await api('post', '/exams/' + after.id + '/comparatives')
      .send({ comparativeExamId: source.id })
      .expect(201)
    await api('post', '/patient-reviews/associations/' + decision.decisionId + '/undo')
      .send({ expectedVersion: 0, reason: 'Associação incorreta identificada' })
      .expect(201)
    const rows = await database.query<Array<{ patient_id: string }>>(
      'SELECT patient_id FROM exams WHERE id=ANY($1::uuid[])',
      [[source.id, after.id]],
    )
    expect(rows.every((r) => r.patient_id === source.patientId)).toBe(true)
    expect(objects.has('reports/' + source.id + '/report.json')).toBe(true)
    // Both dependent exams were restored together; the comparison remains authorized.
    expect(
      body<Array<{ status: string }>>(
        await api('get', '/exams/' + after.id + '/comparatives').expect(200),
      )[0]?.status,
    ).toBe('AVAILABLE')
  })
  it('allows exactly one of two concurrent review decisions', async () => {
    const a = await patient('Candidato Concorrente')
    const incoming = await exam({ patientName: 'Candidato Concorrente' })
    const review = (await reviews()).find((r) => r.patientId === incoming.patientId)
    if (!review) throw Error('Review absent')
    const payload = {
      decision: 'APPROVE',
      targetPatientId: a.id,
      expectedVersion: review.version,
      expectedSourceVersion: review.patient.revision,
      expectedTargetVersion: a.revision,
      reason: 'Conferência simultânea',
    }
    const responses = await Promise.all([
      api('post', '/patient-reviews/' + review.id + '/decision').send(payload),
      api('post', '/patient-reviews/' + review.id + '/decision').send(payload),
    ])
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409])
  })
  it('isolates history, matching, mutation and storage by company and selected unit', async () => {
    const foreign = await exam(
      { unitId: otherUnit, patientName: 'Paciente Estrangeiro' },
      otherCompany,
    )
    jest.clearAllMocks()
    await api('get', '/patients/' + foreign.patientId).expect(404)
    await api('get', '/patients/' + foreign.patientId + '/history').expect(404)
    await api(
      'get',
      '/patients/' + foreign.patientId + '/history/' + foreign.id + '/availability',
    ).expect(404)
    expect(storage.readText).not.toHaveBeenCalled()
    const own = await patient('Paciente Segunda Unidade', secondUnit)
    await api('get', '/patients/' + own.id)
      .set('X-Unit-Id', unit)
      .expect(404)
    expect(
      body<Array<{ id: string }>>(
        await api('get', '/patients').set('X-Unit-Id', unit).expect(200),
      ).some((p) => p.id === own.id),
    ).toBe(false)
  })
  it('links only older authorized exams of the same patient and checks unavailable documents', async () => {
    const p = await patient('Paciente Comparativo')
    const previous = await exam({
      patientId: p.id,
      patientName: p.fullName,
      performedAt: '2026-10-01T12:00:00Z',
    })
    const current = await exam({ patientId: p.id, patientName: p.fullName })
    const link = body<{ id: string }>(
      await api('post', '/exams/' + current.id + '/comparatives')
        .send({ comparativeExamId: previous.id })
        .expect(201),
    )
    expect(
      body<unknown[]>(await api('get', '/exams/' + current.id + '/comparatives').expect(200)),
    ).toHaveLength(1)
    expect(
      body<{ report: string }>(
        await api('get', '/patients/' + p.id + '/history/' + previous.id + '/availability').expect(
          200,
        ),
      ).report,
    ).toBe('UNAVAILABLE')
    await api('post', '/exams/' + previous.id + '/comparatives')
      .send({ comparativeExamId: current.id })
      .expect(400)
    await api('delete', '/exams/' + current.id + '/comparatives/' + link.id).expect(200)
  })
  it('previews collisions, rejects unapproved rows and resumes approved CSV batches idempotently', async () => {
    const p = await patient('Paciente Importado')
    const text = csv([
      unit + ';Novo Sistema;001;' + p.id + ';Sistema Antigo;A001',
      unit + ';Novo Sistema;002;' + p.id + ';;',
    ])
    const batch = await preview(text)
    await api('post', '/patient-imports/' + batch.batch.id + '/commit')
      .send({ limit: 1 })
      .expect(201)
    expect(
      await database.query<Array<{ id: string }>>(
        "SELECT id FROM patient_identifiers WHERE issuer='Novo Sistema'",
      ),
    ).toHaveLength(0)
    await api('post', '/patient-imports/' + batch.batch.id + '/approve-ready').expect(201)
    const partial = body<ImportReport>(
      await api('post', '/patient-imports/' + batch.batch.id + '/commit')
        .send({ limit: 1 })
        .expect(201),
    )
    expect(partial.counts.APPLIED).toBe(1)
    const finished = body<ImportReport>(
      await api('post', '/patient-imports/' + batch.batch.id + '/commit')
        .send({ limit: 100 })
        .expect(201),
    )
    expect(finished.counts.APPLIED).toBe(2)
    expect((await preview(text)).batch.id).toBe(batch.batch.id)
    await api('post', '/patient-imports/' + batch.batch.id + '/commit')
      .send({ limit: 100 })
      .expect(201)
    expect(
      await database.query<Array<{ id: string }>>(
        "SELECT id FROM patient_identifiers WHERE issuer='Novo Sistema'",
      ),
    ).toHaveLength(2)
    const other = await patient('Outro Importado')
    const collision = await preview(csv([unit + ';Novo Sistema;001;' + other.id + ';;']))
    expect(collision.rows[0]?.status).toBe('CONFLICT')
  })
  it('uses reviewed aliases and keeps ambiguous or incompatible types out of automatic classification', async () => {
    const a = body<{ id: string }>(
      await api('post', '/exam-catalog/types')
        .send({ name: 'TC de teste A', modality: 'CT', groupName: 'Teste', active: true })
        .expect(201),
    )
    const b = body<{ id: string }>(
      await api('post', '/exam-catalog/types')
        .send({ name: 'TC de teste B', modality: 'CT', groupName: 'Teste', active: true })
        .expect(201),
    )
    await api('post', '/exam-catalog/aliases')
      .send({ examTypeId: a.id, unitId: unit, description: 'TC abreviada', active: true })
      .expect(201)
    const mapped = await exam({ studyDescription: 'TC ABREVIADA' })
    expect(mapped).toMatchObject({ normalizationStatus: 'APPROVED', examTypeId: a.id })
    await api('post', '/exam-catalog/aliases')
      .send({ examTypeId: b.id, unitId: unit, description: 'TC abreviada', active: true })
      .expect(201)
    const ambiguous = await exam({ studyDescription: 'TC abreviada' })
    expect(ambiguous).toMatchObject({ normalizationStatus: 'AMBIGUOUS', examTypeId: null })
    const reviewed = body<Exam>(
      await api('post', '/exam-catalog/exams/' + ambiguous.id + '/classification')
        .send({
          examTypeId: a.id,
          expectedUpdatedAt: ambiguous.updatedAt,
          teachAlias: true,
          reason: 'Tipo conferido',
        })
        .expect(201),
    )
    expect(reviewed.examTypeId).toBe(a.id)
    expect(await exam({ studyDescription: 'TC abreviada' })).toMatchObject({
      normalizationStatus: 'APPROVED',
      examTypeId: a.id,
    })
    await api('post', '/exam-catalog/exams/' + ambiguous.id + '/classification')
      .send({
        examTypeId: b.id,
        expectedUpdatedAt: ambiguous.updatedAt,
        teachAlias: false,
        reason: 'Decisão concorrente',
      })
      .expect(409)
  })
  it('reverts unused imported identifiers and preserves evidence of the correction', async () => {
    const p = await patient('Paciente Importação Reversível')
    const batch = await preview(csv([unit + ';Sistema Reversível;000777;' + p.id + ';;']))
    await api('post', '/patient-imports/' + batch.batch.id + '/approve-ready').expect(201)
    const applied = body<ImportReport>(
      await api('post', '/patient-imports/' + batch.batch.id + '/commit')
        .send({ limit: 1 })
        .expect(201),
    )
    const row = applied.rows[0]!
    const undone = body<ImportReport>(
      await api('post', '/patient-imports/' + batch.batch.id + '/rows/' + row.id + '/undo')
        .send({ expectedVersion: row.version, reason: 'Paciente incorreto na planilha' })
        .expect(201),
    )
    expect(undone.rows[0]?.status).toBe('REJECTED')
    expect(
      await database.query("SELECT id FROM patient_identifiers WHERE issuer='Sistema Reversível'"),
    ).toHaveLength(0)
    expect(
      await database.query(
        "SELECT id FROM operational_events WHERE action='PATIENT_IMPORT_ROW_REVERTED'",
      ),
    ).toHaveLength(1)
    await api('post', '/patient-imports/' + batch.batch.id + '/rows/' + row.id + '/undo')
      .send({ expectedVersion: row.version, reason: 'Repetição incorreta' })
      .expect(409)
  })
  it('opens manual review and blocks removal of an imported identifier already used by an exam', async () => {
    const p = await patient('Paciente Importação Conferida')
    const opened = body<Review>(
      await api('post', '/patient-reviews/patients/' + p.id)
        .send({ expectedVersion: p.revision, reason: 'Conferir dados da planilha' })
        .expect(201),
    )
    expect(
      body<Review>(
        await api('post', '/patient-reviews/patients/' + p.id)
          .send({ expectedVersion: p.revision, reason: 'Conferência repetida' })
          .expect(201),
      ).id,
    ).toBe(opened.id)
    const batch = await preview(csv([unit + ';Sistema Utilizado;123-usado;' + p.id + ';;']))
    await api('post', '/patient-imports/' + batch.batch.id + '/approve-ready').expect(201)
    const applied = body<ImportReport>(
      await api('post', '/patient-imports/' + batch.batch.id + '/commit')
        .send({ limit: 1 })
        .expect(201),
    )
    await exam({
      patientName: p.fullName,
      originIssuer: 'Sistema Utilizado',
      externalPatientId: '123-usado',
    })
    const row = applied.rows[0]!
    await api('post', '/patient-imports/' + batch.batch.id + '/rows/' + row.id + '/undo')
      .send({ expectedVersion: row.version, reason: 'Correção depois de exame' })
      .expect(409)
  })
  it('rejects inactive-unit creation and whitespace-only identifiers', async () => {
    const p = await patient('Paciente Validação')
    await api('post', '/patients/' + p.id + '/identifiers')
      .send({ unitId: unit, issuer: 'MV', originalValue: '   ', reason: 'Valor inválido' })
      .expect(400)
    const inactive = body<{ id: string }>(
      await api('post', '/hospital-units')
        .send({ name: 'Unidade Inativa Identificação' })
        .expect(201),
    )
    await request(server)
      .patch('/api/v1/hospital-units/' + inactive.id + '/revoke')
      .set('Authorization', 'Bearer ' + token)
      .set('X-Company-Id', initialCompanyId)
      .expect(200)
    await api('post', '/patients')
      .send({ fullName: 'Paciente Unidade Inativa', unitId: inactive.id, country: 'Brasil' })
      .expect(400)
    await api('post', '/patients/' + p.id + '/identifiers')
      .send({ unitId: inactive.id, issuer: 'MV', originalValue: '123', reason: 'Unidade inativa' })
      .expect(400)
  })
  it('protects identifiers referenced by another applied import row', async () => {
    const p = await patient('Paciente Importação Dependente')
    const first = await preview(csv([unit + ';Sistema Dependente;001-dependente;' + p.id + ';;']))
    await api('post', '/patient-imports/' + first.batch.id + '/approve-ready').expect(201)
    const firstApplied = body<ImportReport>(
      await api('post', '/patient-imports/' + first.batch.id + '/commit')
        .send({ limit: 1 })
        .expect(201),
    )
    const second = await preview(
      csv([
        unit + ';Sistema Dependente;001-dependente;' + p.id + ';Sistema Legado Dependente;antigo-1',
      ]),
    )
    await api('post', '/patient-imports/' + second.batch.id + '/approve-ready').expect(201)
    const secondApplied = body<ImportReport>(
      await api('post', '/patient-imports/' + second.batch.id + '/commit')
        .send({ limit: 1 })
        .expect(201),
    )
    const a = firstApplied.rows[0]!,
      b = secondApplied.rows[0]!
    await api('post', '/patient-imports/' + first.batch.id + '/rows/' + a.id + '/undo')
      .send({ expectedVersion: a.version, reason: 'Correção com referência posterior' })
      .expect(409)
    await api('post', '/patient-imports/' + second.batch.id + '/rows/' + b.id + '/undo')
      .send({ expectedVersion: b.version, reason: 'Desfazer linha dependente' })
      .expect(201)
    await api('post', '/patient-imports/' + first.batch.id + '/rows/' + a.id + '/undo')
      .send({ expectedVersion: a.version, reason: 'Desfazer linha inicial' })
      .expect(201)
  })
  it('rolls back patient and exam creation when audit persistence fails', async () => {
    const before = await database.query<Array<{ count: string }>>(
      'SELECT COUNT(*)::text AS count FROM patients',
    )
    const mock = jest
      .spyOn(app.get(OperationalAuditService), 'record')
      .mockRejectedValueOnce(new Error('Falha de auditoria simulada'))
    try {
      await api('post', '/patients')
        .send({ fullName: 'Paciente revertido', unitId: unit, country: 'Brasil' })
        .expect(500)
    } finally {
      mock.mockRestore()
    }
    expect(
      await database.query<Array<{ count: string }>>(
        'SELECT COUNT(*)::text AS count FROM patients',
      ),
    ).toEqual(before)
  })
})
