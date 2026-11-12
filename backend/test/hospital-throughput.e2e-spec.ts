import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticDicom } from './synthetic-documents'

describe('Hospital study throughput with complete receipt enforcement', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  beforeAll(async () => { f = await createOperationalDocumentsFixture() }, 30000)
  afterAll(async () => { await f?.app.close() })
  it('validates four files concurrently, preserves every instance and blocks review until the whole batch is accepted', async () => {
    const deliveryId = randomUUID(), total = 12
    for (let index = 1; index <= total; index++) {
      const bytes = syntheticDicom({ instance: `1.2.826.0.1.3680043.10.987.${index}` })
      const { id } = responseBody<{ id: string }>(await f.api('post', '/uploads').send({
        kind: 'DICOM', hospitalIntake: true, unitId: f.unit, name: 'synthetic.dcm', contentType: 'application/dicom', sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), deliveryId, deliveryFileId: randomUUID(), deliveryTotal: total,
      }).expect(201))
      const upload = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id })
      f.stored.set(upload.storageKey, { body: bytes, metadata: { sha256: upload.sha256 } })
      await f.database.getRepository(UploadSessionEntity).update(id, { status: 'RECEIVED' })
    }
    let active = 0, maximum = 0
    f.scanner.scan.mockImplementation(async () => {
      maximum = Math.max(maximum, ++active)
      await delay(50)
      active--
      return 'CLEAN'
    })
    const worker = f.app.get(ImageIngestionWorker)
    await worker.runBatch()
    expect(maximum).toBe(4)
    type Intake = { id: string; status: string; receipt: { expected: number; validated: number } }
    const [partial] = responseBody<Intake[]>(await f.api('get', '/hospital/intakes').expect(200))
    expect(partial).toMatchObject({ status: 'RECEIVING', receipt: { expected: total, validated: 8 } })
    await f.api('get', `/hospital/intakes/${partial!.id}`).expect(409)
    await Promise.all([worker.runBatch(), worker.runBatch()])
    const [ready] = responseBody<Intake[]>(await f.api('get', '/hospital/intakes').expect(200))
    expect(ready).toMatchObject({ id: partial!.id, status: 'DRAFT', receipt: { expected: total, validated: total } })
    const detail = responseBody<{ files: unknown[] }>(await f.api('get', `/hospital/intakes/${ready!.id}`).expect(200))
    expect(detail.files).toHaveLength(total)
    expect(f.scanner.scan).toHaveBeenCalledTimes(total)
  }, 30000)
})
