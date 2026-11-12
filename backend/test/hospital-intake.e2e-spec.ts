import { createHash, randomBytes, randomUUID } from 'node:crypto'
import request from 'supertest'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticDicom } from './synthetic-documents'

describe('Hospital review before delivery to SouRad (e2e)', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let recipientCompany: string
  beforeAll(async () => {
    f = await createOperationalDocumentsFixture()
    recipientCompany = responseBody<{ id: string }>(await f.api('post', '/companies').send({ name: 'SouRad destinatária' }).expect(201)).id
    const unit = responseBody<{ id: string }>(await f.api('post', '/hospital-units', recipientCompany).send({ name: 'Unidade do hospital na SouRad' }).expect(201)).id
    await f.api('post', '/hospital/referral-routes').send({ unitId: f.unit, recipientCompanyId: recipientCompany, recipientUnitId: unit }).expect(201)
  }, 30000)
  afterAll(async () => { await f?.app.close() })
  const stage = async (bytes: Buffer, delivery: { deliveryId: string; deliveryFileId: string; deliveryTotal: number } | Record<string, never> = {}) => {
    const { id } = responseBody<{ id: string }>(await f.api('post', '/uploads').send({
      kind: 'DICOM', unitId: f.unit, hospitalIntake: true, name: 'synthetic.dcm',
      contentType: 'application/dicom', sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ...delivery,
    }).expect(201))
    const upload = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id })
    f.pending.get(upload.multipartId)!.parts.set(1, bytes)
    await f.api('post', `/uploads/${id}/complete`).expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    return id
  }
  const drafts = async () => responseBody<Array<{ id: string; version: number; fields: Record<string, unknown>; status: string; examId: string | null; submittedFields: Record<string, unknown> | null }>>(
    await f.api('get', '/hospital/intakes').expect(200),
  )
  it('holds DICOMs outside the exam queue until a complete reviewed submission; sending is idempotent', async () => {
    const uploadId = await stage(syntheticDicom())
    const staged = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: uploadId })
    expect(staged.status).toBe('AWAITING_REVIEW')
    expect(staged.examId).toBeNull()
    const [intake] = responseBody<Array<{ id: string; version: number; fields: Record<string, unknown>; status: string }>>(
      await f.api('get', '/hospital/intakes').expect(200),
    )
    if (!intake) throw new Error('Expected hospital draft')
    expect(intake.status).toBe('DRAFT')
    expect(intake.fields.patientName).toBeTruthy()
    await f.api('get', `/hospital/intakes/${intake.id}`).set('X-Unit-Id', f.secondUnit).expect(404)
    await f.api('post', `/hospital/intakes/${intake.id}/submit`).send({ expectedVersion: intake.version, fields: {} }).expect(400)
    const submitted = responseBody<{ examId: string }>(await f.api('post', `/hospital/intakes/${intake.id}/submit`).send({
      expectedVersion: intake.version, fields: { ...intake.fields, country: 'Brasil', priority: 'ROTINA', performedAt: '2026-11-10T10:00:00-03:00' },
    }).expect(201))
    expect(submitted.examId).toBeTruthy()
    const queue = responseBody<{ items: Array<{ id: string }> }>(await f.api('get', '/exams', recipientCompany).expect(200))
    expect(queue.items.some(exam => exam.id === submitted.examId)).toBe(true)
    const repeated = responseBody<{ examId: string }>(await f.api('post', `/hospital/intakes/${intake.id}/submit`).send({
      expectedVersion: intake.version, fields: { ...intake.fields, country: 'Brasil', priority: 'ROTINA', performedAt: '2026-11-10T10:00:00-03:00' },
    }).expect(201))
    expect(repeated.examId).toBe(submitted.examId)
    expect((await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: uploadId })).status).toBe('FORWARDED')
  })
  it('reopens late images, rejects stale reviews and delivers supplements to the original exam', async () => {
    const previous = (await drafts())[0]!
    await stage(syntheticDicom({ instance: '1.2.826.0.1.3680043.10.100.999' }))
    const reopened = (await drafts())[0]!
    expect(reopened.status).toBe('DRAFT')
    expect(reopened.examId).toBe(previous.examId)
    await f.api('post', `/hospital/intakes/${reopened.id}/submit`).send({ expectedVersion: previous.version, fields: reopened.fields }).expect(409)
    await f.api('post', `/hospital/intakes/${reopened.id}/submit`).send({ expectedVersion: reopened.version, fields: { ...reopened.fields, patientName: 'Alteração não autorizada' } }).expect(409)
    const sent = responseBody<{ examId: string }>(await f.api('post', `/hospital/intakes/${reopened.id}/submit`).send({ expectedVersion: reopened.version, fields: reopened.fields }).expect(201))
    expect(sent.examId).toBe(previous.examId)
    await stage(syntheticDicom())
    expect((await drafts())[0]!.status).toBe('SUBMITTED')
  })
  it('saves incomplete drafts, blocks invalid final forms, isolates companies and quarantines identity collisions', async () => {
    const unique = { study: '1.2.826.0.1.3680043.10.200.1', series: '1.2.826.0.1.3680043.10.200.2', instance: '1.2.826.0.1.3680043.10.200.3', birth: '', timezone: '' }
    await stage(syntheticDicom(unique))
    const draft = (await drafts()).find(row => row.status === 'DRAFT')!
    expect(draft.fields.birthDate).toBeUndefined()
    expect(draft.fields.performedAt).toBeUndefined()
    await f.api('patch', `/hospital/intakes/${draft.id}`).send({ expectedVersion: draft.version, fields: { patientName: 'Cadastro revisado' } }).expect(200)
    const updated = responseBody<typeof draft>(await f.api('get', `/hospital/intakes/${draft.id}`).expect(200))
    expect(updated.fields.patientName).toBe('Cadastro revisado')
    await f.api('post', `/hospital/intakes/${draft.id}/submit`).send({ expectedVersion: updated.version, fields: updated.fields }).expect(400)
    await f.api('get', `/hospital/intakes/${draft.id}`, '00000000-0000-4000-8000-000000000099').expect(403)
    const collisionId = await stage(syntheticDicom({ ...unique, name: 'Outra^Identidade', instance: '1.2.826.0.1.3680043.10.200.4' }))
    expect((await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: collisionId })).status).toBe('QUARANTINED')
    const complete = { ...updated.fields, birthDate: '1990-01-01', performedAt: '2026-11-10T10:00:00-03:00' }
    await f.api('post', `/hospital/intakes/${draft.id}/submit`).send({ expectedVersion: updated.version, fields: complete }).expect(201)
  })
  it('rolls back the entire delivery when two received files collide under one instance UID', async () => {
    const collision = { study: '1.2.826.0.1.3680043.10.300.1', series: '1.2.826.0.1.3680043.10.300.2', instance: '1.2.826.0.1.3680043.10.300.3' }
    const first = await stage(syntheticDicom(collision))
    const second = await stage(syntheticDicom({ ...collision, time: '130000' }))
    const draft = (await drafts()).find(row => row.status === 'DRAFT')!
    await f.api('post', `/hospital/intakes/${draft.id}/submit`).send({ expectedVersion: draft.version, fields: draft.fields }).expect(409)
    for (const id of [first, second]) {
      const upload = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id })
      expect(upload.status).toBe('AWAITING_REVIEW')
      expect(upload.examId).toBeNull()
    }
    const result = await f.database.query<Array<{ count: number }>>('SELECT COUNT(*)::int AS count FROM exams WHERE source_exam_id=$1', [collision.study])
    expect(result[0]!.count).toBe(0)
  })
  it('allows hospital preparation while denying the internal exam queue and reports', async () => {
    const roles = responseBody<Array<{ id: string; code: string }>>(await f.api('get', '/access-control/roles').expect(200))
    const hospital = roles.find(role => role.code === 'HOSPITAL')!
    const account = responseBody<{ initialPassword: string }>(await f.api('post', '/company-memberships').send({
      email: 'hospital@integration.test', fullName: 'Operador do Hospital', roleId: hospital.id, unitIds: [f.unit], allUnits: false,
    }).expect(201))
    const verifier = randomBytes(64).toString('base64url')
    const authorization = responseBody<{ authorizationCode: string }>(await request(f.server).post('/api/v1/auth/login').send({
      email: 'hospital@integration.test', password: account.initialPassword, clientId: 'crm-web', remember: false,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256', state: randomBytes(32).toString('base64url'),
    }).expect(200))
    const { accessToken } = responseBody<{ accessToken: string }>(await request(f.server).post('/api/v1/auth/token')
      .set('Origin', 'http://localhost:5173').set('X-Requested-With', 'XMLHttpRequest')
      .send({ grantType: 'authorization_code', clientId: 'crm-web', authorizationCode: authorization.authorizationCode, codeVerifier: verifier }).expect(200))
    const api = (method: 'get' | 'put', path: string) => request(f.server)[method]('/api/v1' + path)
      .set('Authorization', 'Bearer ' + accessToken).set('X-Company-Id', initialCompanyId)
    await api('put', '/auth/password').send({ currentPassword: account.initialPassword, newPassword: 'Senha hospitalar de integração 2026!' }).expect(200)
    const accessible = responseBody<Array<{ unitId: string }>>(await api('get', '/hospital/intakes').expect(200))
    expect(accessible.every(row => row.unitId === f.unit)).toBe(true)
    await api('get', '/exams').expect(403)
    const sent = (await drafts()).find(row => row.examId)!
    await api('get', `/exams/${sent.examId}/report`).expect(403)
    await api('get', '/hospital/intakes').set('X-Unit-Id', f.secondUnit).expect(404)
  })
  it('holds the review, DICOM viewer, save and submission until every declared file is staged, including pauses and retry', async () => {
    const study = '1.2.826.0.1.3680043.10.301.1', deliveryId = randomUUID(), deliveryFileId = randomUUID()
    await stage(syntheticDicom({ study, series: study + '.100', instance: study + '.1' }), { deliveryId, deliveryFileId: randomUUID(), deliveryTotal: 2 })
    const first = responseBody<Array<{ id: string; studyUid: string; version: number; fields: Record<string, unknown>; status: string; receipt: { expected: number; validated: number } }>>(await f.api('get', '/hospital/intakes').expect(200)).find(r => r.studyUid === study)!
    expect(first.status).toBe('RECEIVING')
    expect(first.receipt).toMatchObject({ expected: 2, validated: 1 })
    await f.api('get', `/hospital/intakes/${first.id}`).expect(409)
    await f.api('patch', `/hospital/intakes/${first.id}`).send({ expectedVersion: first.version, fields: {} }).expect(409)
    await f.api('post', `/hospital/intakes/${first.id}/submit`).send({ expectedVersion: first.version, fields: first.fields }).expect(409)
    await f.api('post', `/hospital/intakes/${first.id}/images/viewer`).expect(409)
    const bytes = syntheticDicom({ study, series: study + '.100', instance: study + '.2' })
    const input = { kind: 'DICOM', unitId: f.unit, hospitalIntake: true, name: 'pending.dcm', contentType: 'application/dicom', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), deliveryId, deliveryFileId, deliveryTotal: 2 }
    await f.api('post', '/uploads').send({ ...input, deliveryTotal: 1 }).expect(409)
    const cancelled = responseBody<{ id: string }>(await f.api('post', '/uploads').send(input).expect(201))
    await f.api('post', `/uploads/${cancelled.id}/cancel`).expect(201)
    await f.api('get', `/hospital/intakes/${first.id}`).expect(409)
    const retry = responseBody<{ id: string }>(await f.api('post', '/uploads').send(input).expect(201))
    const upload = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: retry.id })
    f.pending.get(upload.multipartId)!.parts.set(1, bytes)
    await f.api('post', `/uploads/${retry.id}/complete`).expect(201)
    await f.api('get', `/hospital/intakes/${first.id}`).expect(409)
    await f.app.get(ImageIngestionWorker).runBatch()
    const complete = responseBody<typeof first>(await f.api('get', `/hospital/intakes/${first.id}`).expect(200))
    expect(complete.status).toBe('DRAFT')
    await f.api('post', `/hospital/intakes/${first.id}/submit`).send({ expectedVersion: first.version, fields: complete.fields }).expect(409)
    await f.api('post', `/hospital/intakes/${first.id}/submit`).send({ expectedVersion: complete.version, fields: complete.fields }).expect(201)
  })
})
