import { createHash, randomUUID } from 'node:crypto'
import request from 'supertest'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticDicom } from './synthetic-documents'

describe('Hospital folder receipt completion', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>, token: string, intakeId: string
  beforeAll(async () => {
    f = await createOperationalDocumentsFixture()
    token = responseBody<{ token: string }>(await f.api('post', '/dicom-sources').send({ unitId: f.unit, name: 'Synthetic folder source' }).expect(201)).token
  }, 30000)
  afterAll(async () => { await f?.app.close() })
  const agent = (path: string) => request(f.server).post('/api/v1/dicom-agent' + path).set('Authorization', 'Bearer ' + token)
  const diagnostic = (pending: number, failed = 0) => agent('/heartbeat').send({ version: '0.3.0', pending, failed, freeBytes: 1000000000 }).expect(201)
  it('does not release a validated batch while the agent still has local files, and keeps unrelated units accessible', async () => {
    await diagnostic(1)
    const bytes = syntheticDicom(), id = responseBody<{ id: string }>(await agent('/uploads').send({
      kind: 'DICOM', hospitalIntake: true, unitId: f.unit, name: 'synthetic.dcm', contentType: 'application/dicom', sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), deliveryId: randomUUID(), deliveryFileId: randomUUID(), deliveryTotal: 1,
    }).expect(201)).id
    const upload = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id })
    f.pending.get(upload.multipartId)!.parts.set(1, bytes)
    await agent(`/uploads/${id}/complete`).expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    const row = responseBody<Array<{ id: string; status: string; receipt: { expected: number; validated: number } }>>(await f.api('get', '/hospital/intakes').expect(200))[0]!
    intakeId = row.id
    expect(row).toMatchObject({ status: 'RECEIVING', receipt: { expected: 1, validated: 1 } })
    await f.api('get', `/hospital/intakes/${intakeId}`).expect(409)
    await agent('/heartbeat').send({ version: '0.3.0', pending: 0, failed: 0, freeBytes: 1000000000, diagnosticOnly: true }).expect(201)
    await f.api('get', `/hospital/intakes/${intakeId}`).expect(409)
    await f.api('get', `/hospital/intakes/${intakeId}`).set('X-Unit-Id', f.secondUnit).expect(404)
    await diagnostic(0, 1)
    await f.api('get', `/hospital/intakes/${intakeId}`).expect(409)
    await diagnostic(0)
    expect(responseBody<{ status: string }>(await f.api('get', `/hospital/intakes/${intakeId}`).expect(200)).status).toBe('DRAFT')
  })
})
