import { createHash } from 'node:crypto'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticDicom } from './synthetic-documents'

describe('Hospital company forwards studies to a separate reporting company (e2e)', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let recipient: string, recipientUnit: string
  beforeAll(async () => {
    f = await createOperationalDocumentsFixture()
    recipient = responseBody<{ id: string }>(await f.api('post', '/companies').send({ name: 'SouRad destinatária de teste' }).expect(201)).id
    recipientUnit = responseBody<{ id: string }>(await f.api('post', '/hospital-units', recipient).send({ name: 'Unidade de origem no laudário' }).expect(201)).id
  }, 30000)
  afterAll(async () => { await f?.app.close() })
  const routing = (active = true) => f.api('post', '/hospital/referral-routes').send({ unitId: f.unit, recipientCompanyId: recipient, recipientUnitId: recipientUnit, active }).expect(201)
  const stage = async (suffix: string) => {
    const bytes = syntheticDicom({ study: `1.2.826.0.1.3680043.10.600.${suffix}`, series: `1.2.826.0.1.3680043.10.601.${suffix}`, instance: `1.2.826.0.1.3680043.10.602.${suffix}` })
    const { id } = responseBody<{ id: string }>(await f.api('post', '/uploads').send({ kind: 'DICOM', unitId: f.unit, hospitalIntake: true, name: 'synthetic.dcm', contentType: 'application/dicom', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }).expect(201))
    const row = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id })
    f.pending.get(row.multipartId)!.parts.set(1, bytes)
    await f.api('post', `/uploads/${id}/complete`).expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    return row
  }
  const drafts = () => f.api('get', '/hospital/intakes').expect(200).then(result => responseBody<Array<{ id: string; version: number; fields: Record<string, unknown>; examId: string | null }>>(result))

  it('keeps the draft and original uploads exclusively in the hospital until explicit forwarding', async () => {
    await routing()
    const source = await stage('1'), draft = (await drafts())[0]!
    expect(draft.examId).toBeNull()
    expect(responseBody<unknown[]>(await f.api('get', '/hospital/intakes', recipient).expect(200))).toHaveLength(0)
    await f.api('get', `/hospital/intakes/${draft.id}`, recipient).expect(404)
    expect(responseBody<{ total: number }>(await f.api('get', '/exams', recipient).expect(200)).total).toBe(0)
    const sent = responseBody<{ examId: string }>(await f.api('post', `/hospital/intakes/${draft.id}/submit`).send({ expectedVersion: draft.version, fields: draft.fields }).expect(201))
    const sourceQueue = responseBody<{ total: number }>(await f.api('get', '/exams').expect(200))
    const targetQueue = responseBody<{ items: Array<{ id: string; unitId: string }> }>(await f.api('get', '/exams', recipient).expect(200))
    expect(sourceQueue.total).toBe(0)
    expect(targetQueue.items).toHaveLength(1)
    expect(targetQueue.items[0]).toMatchObject({ id: sent.examId, unitId: recipientUnit })
    const original = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: source.id })
    expect(original.companyId).toBe(initialCompanyId)
    expect(original.status).toBe('FORWARDED')
    expect(original.examId).toBeNull()
    const copy = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ originUploadId: source.id })
    expect(copy.companyId).toBe(recipient)
    expect(copy.examId).toBe(sent.examId)
    expect(copy.storageKey).not.toBe(original.storageKey)
    expect(copy.sha256).toBe(original.sha256)
    await f.api('get', `/uploads/${copy.id}`).expect(404)
    await f.api('get', `/uploads/${original.id}`, recipient).expect(404)
    await f.api('get', `/exams/${sent.examId}/images`).expect(404)
    await f.api('get', `/exams/${sent.examId}/images`, recipient).expect(200)
  })
  it('blocks forwarding when no active route exists and does not silently publish in the hospital', async () => {
    await routing(false)
    const source = await stage('2'), draft = (await drafts()).find(row => !row.examId)!
    await f.api('post', `/hospital/intakes/${draft.id}/submit`).send({ expectedVersion: draft.version, fields: draft.fields }).expect(409)
    expect((await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: source.id })).status).toBe('AWAITING_REVIEW')
    expect(responseBody<{ total: number }>(await f.api('get', '/exams').expect(200)).total).toBe(0)
    await routing()
    f.storage.copy.mockRejectedValueOnce(new Error('STORAGE_UNAVAILABLE'))
    await f.api('post', `/hospital/intakes/${draft.id}/submit`).send({ expectedVersion: draft.version, fields: draft.fields }).expect(503)
    expect((await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: source.id })).status).toBe('AWAITING_REVIEW')
    await f.api('post', `/hospital/intakes/${draft.id}/submit`).send({ expectedVersion: draft.version, fields: draft.fields }).expect(201)
  })
})
