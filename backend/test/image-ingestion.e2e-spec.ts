import { createHash } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import request from 'supertest'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import {
  DicomIngestionService,
  type DicomUploadMetadata,
} from '../src/modules/dicom/dicom-ingestion.service'
import { UploadValidationWorker } from '../src/modules/document-uploads/upload-validation-worker.service'
import { ValidationUnavailable } from '../src/modules/file-validation/clamav-scanner.service'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticDicom, syntheticPdf } from './synthetic-documents'
import { uploadPartSize } from '../src/modules/document-uploads/upload.policy'
import { OperationalAuditService } from '../src/modules/companies/operational-audit.service'
describe('Resumable files and DICOM ingestion (e2e)', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let exam: { id: string; patientId: string }
  const session = async (bytes: Buffer, kind = 'DICOM', extra: Record<string, unknown> = {}) => {
    const created = responseBody<{ id: string }>(
      await f
        .api('post', '/uploads')
        .send({
          kind,
          unitId: f.unit,
          name: kind === 'DICOM' ? 'synthetic.dcm' : 'pedido.pdf',
          contentType: kind === 'DICOM' ? 'application/dicom' : 'application/pdf',
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          ...(kind === 'ATTACHMENT' ? { examId: exam.id, category: 'ORDER' } : {}),
          ...extra,
        })
        .expect(201),
    )
    const stored = await f.database
      .getRepository(UploadSessionEntity)
      .findOneByOrFail({ id: created.id })
    return { id: created.id, pending: f.pending.get(stored.multipartId)!, stored }
  }
  const upload = async (bytes: Buffer, kind = 'DICOM', extra: Record<string, unknown> = {}) => {
    const created = await session(bytes, kind, extra)
    for (let number = 1; number <= Math.ceil(bytes.length / uploadPartSize); number++)
      created.pending.parts.set(
        number,
        bytes.subarray((number - 1) * uploadPartSize, number * uploadPartSize),
      )
    await f.api('post', `/uploads/${created.id}/complete`).expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    return responseBody<{
      id: string
      status: string
      examId: string
      resultId: string
      metadata: { tags: { studyUid: string } }
    }>(await f.api('get', `/uploads/${created.id}`).expect(200))
  }
  beforeAll(async () => {
    f = await createOperationalDocumentsFixture()
    exam = await f.exam()
  }, 30000)
  afterAll(async () => {
    await f?.app.close()
  })
  it('resumes parts, blocks incomplete completion and publishes only after validation', async () => {
    const pdf = Buffer.concat([await syntheticPdf(), Buffer.alloc(uploadPartSize, ' ')])
    const created = await session(pdf, 'ATTACHMENT')
    created.pending.parts.set(1, pdf.subarray(0, uploadPartSize))
    expect(
      responseBody<{ parts: unknown[] }>(await f.api('get', `/uploads/${created.id}`).expect(200))
        .parts,
    ).toHaveLength(1)
    await f.api('post', `/uploads/${created.id}/complete`).expect(409)
    await f.api('post', `/uploads/${created.id}/parts/3`).expect(400)
    created.pending.parts.set(2, pdf.subarray(uploadPartSize))
    await f.api('post', `/uploads/${created.id}/complete`).expect(201)
    expect(
      responseBody<unknown[]>(await f.api('get', `/exams/${exam.id}/attachments`).expect(200)),
    ).toHaveLength(0)
    await f.app.get(ImageIngestionWorker).runBatch()
    expect(
      responseBody<{ status: string }>(await f.api('get', `/uploads/${created.id}`).expect(200))
        .status,
    ).toBe('PUBLISHED')
  })
  it('accepts authenticated bounded binary parts through the API without bucket CORS',async()=>{
    const pdf=await syntheticPdf(),created=await session(pdf,'ATTACHMENT')
    await f.api('put',`/uploads/${created.id}/parts/1`).set('X-Unit-Id',f.secondUnit).set('Content-Type','application/octet-stream').send(pdf).expect(404)
    await f.api('put',`/uploads/${created.id}/parts/1`).set('Content-Type','application/octet-stream').send(Buffer.from('too short')).expect(400)
    await f.api('put',`/uploads/${created.id}/parts/1`).set('Content-Type','application/octet-stream').send(pdf).expect(200)
    await f.api('post',`/uploads/${created.id}/complete`).expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    expect(responseBody<{status:string}>(await f.api('get',`/uploads/${created.id}`).expect(200)).status).toBe('PUBLISHED')
  })
  it('isolates sessions, rejects unsafe sizes, aborts cancelled and expired uploads', async () => {
    const created = await session(await syntheticPdf(), 'ATTACHMENT')
    await f.api('get', `/uploads/${created.id}`).set('X-Unit-Id', f.secondUnit).expect(404)
    await f.api('post', `/uploads/${created.id}/cancel`).expect(201)
    await f.api('post', `/uploads/${created.id}/parts/1`).expect(409)
    expect(f.pending.has(created.stored.multipartId)).toBe(false)
    const expired = await session(await syntheticPdf(), 'ATTACHMENT')
    await f.database
      .getRepository(UploadSessionEntity)
      .update(expired.id, { expiresAt: new Date(Date.now() - 1000) })
    await f.app.get(UploadValidationWorker).runBatch()
    expect(
      (await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: expired.id }))
        .status,
    ).toBe('EXPIRED')
    await f
      .api('post', '/uploads')
      .send({
        kind: 'DICOM',
        unitId: f.unit,
        name: 'a.dcm',
        contentType: 'application/dicom',
        sizeBytes: 0,
        sha256: 'a'.repeat(64),
      })
      .expect(400)
  })
  it('quarantines unavailable scans and rejects invalid bytes or hashes', async () => {
    f.scanner.scan.mockRejectedValueOnce(new ValidationUnavailable('offline'))
    const quarantined = await upload(await syntheticPdf(), 'ATTACHMENT')
    expect(quarantined.status).toBe('QUARANTINED')
    await f.api('post', `/uploads/${quarantined.id}/reprocess`).expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    expect(
      responseBody<{ status: string }>(await f.api('get', `/uploads/${quarantined.id}`).expect(200))
        .status,
    ).toBe('PUBLISHED')
    expect((await upload(Buffer.from('disguised'), 'ATTACHMENT')).status).toBe('REJECTED')
    expect(
      (await upload(await syntheticPdf(), 'ATTACHMENT', { sha256: '0'.repeat(64) })).status,
    ).toBe('REJECTED')
  })
  it('creates a canonical exam and patient, deduplicates concurrent retransmission and counts late instances', async () => {
    const bytes = syntheticDicom()
    const created = await Promise.all([session(bytes), session(bytes)])
    for (const item of created) item.pending.parts.set(1, bytes)
    await Promise.all(
      created.map((item) => f.api('post', `/uploads/${item.id}/complete`).expect(201)),
    )
    await f.app.get(UploadValidationWorker).runBatch()
    const approved = await Promise.all(
      created.map((item) =>
        f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: item.id }),
      ),
    )
    await Promise.all(
      approved.map((item) =>
        f.app.get(DicomIngestionService).ingest(item, item.payload.metadata as DicomUploadMetadata),
      ),
    )
    await f.app.get(ImageIngestionWorker).runBatch()
    const results = await Promise.all(
      created.map(async (item) =>
        responseBody<{ status: string; examId: string }>(
          await f.api('get', `/uploads/${item.id}`).expect(200),
        ),
      ),
    )
    expect(results.every((x) => x.status === 'PUBLISHED')).toBe(true)
    expect(new Set(results.map((x) => x.examId)).size).toBe(1)
    const examId = results[0]!.examId
    expect(
      responseBody<{ items: Array<{ instances: number; series: number }> }>(
        await f.api('get', `/exams/${examId}/images`).expect(200),
      ).items[0],
    ).toMatchObject({ instances: 1, series: 1 })
    await f
      .api('post', `/exams/${examId}/images/complete`)
      .send({ reason: 'Fim operacional informado' })
      .expect(201)
    const late = await upload(
      syntheticDicom({
        series: '1.2.826.0.1.3680043.10.100.4',
        instance: '1.2.826.0.1.3680043.10.100.5',
      }),
    )
    expect(late.examId).toBe(examId)
    expect(
      responseBody<{ status: string; items: Array<{ instances: number; series: number }> }>(
        await f.api('get', `/exams/${examId}/images`).expect(200),
      ),
    ).toMatchObject({
      status: 'RECEIVING',
      items: [
        expect.objectContaining({ instances: 2, series: 2, clinicalCompleteness: 'NOT_ATTESTED' }),
      ],
    })
  })
  it('preserves studies on UID collisions and keeps approximate matches for human review', async () => {
    expect((await upload(syntheticDicom({ name: 'Outro^Paciente' }))).status).toBe('QUARANTINED')
    const separate = await upload(
      syntheticDicom({ study: '1.2.9.11', series: '1.2.9.12', instance: '1.2.9.13' }),
    )
    expect(separate.status).toBe('PUBLISHED')
    const reviews = responseBody<Array<{ kind: string }>>(
      await f.api('get', '/dicom-reviews').expect(200),
    )
    expect(reviews.map((x) => x.kind)).toEqual(
      expect.arrayContaining(['IDENTITY_COLLISION', 'POSSIBLE_DUPLICATE']),
    )
  })
  it('holds missing demographics for explicit correction with an audited decision', async () => {
    const held = await upload(
      syntheticDicom({ study: '1.2.10.1', series: '1.2.10.2', instance: '1.2.10.3', birth: '' }),
    )
    expect(held.status).toBe('QUARANTINED')
    const review = responseBody<Array<{ id: string; uploadId: string }>>(
      await f.api('get', '/dicom-reviews').expect(200),
    ).find((x) => x.uploadId === held.id)!
    await f
      .api('post', `/dicom-reviews/${review.id}/resolve`)
      .send({
        expectedVersion: 0,
        action: 'CORRECT',
        reason: 'Dados sintéticos conferidos',
        exam: {
          unitId: f.unit,
          patientName: 'Teste Paciente',
          birthDate: '1990-01-01',
          sex: 'FEMININO',
          country: 'Brasil',
          studyDescription: 'TC teste',
          modality: 'CT',
          priority: 'ROTINA',
          performedAt: '2026-10-14T12:00:00-03:00',
        },
      })
      .expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    expect(
      responseBody<{ status: string }>(await f.api('get', `/uploads/${held.id}`).expect(200))
        .status,
    ).toBe('PUBLISHED')
    await f
      .api('post', `/dicom-reviews/${review.id}/resolve`)
      .send({ expectedVersion: 0, action: 'ACKNOWLEDGE', reason: 'Repetida' })
      .expect(409)
  })
  it('issues expiring viewer access and filters DICOMweb metadata from other scopes', async () => {
    const existing = responseBody<Array<{ examId: string }>>(
      await f.api('get', '/uploads').expect(200),
    ).find((x) => x.examId && x.examId !== exam.id)!
    f.app.get(ConfigService).set('OHIF_VIEWER_URL', 'https://viewer.example.test/viewer')
    const grant = responseBody<{ url: string }>(
      await f.api('post', `/exams/${existing.examId}/images/viewer`).send({}).expect(201),
    )
    const config = new URL(new URL(grant.url).searchParams.get('configUrl')!)
    const token = config.pathname.split('/')[4]!
    await request(f.server).get(`/api/v1/dicom-viewer/${token}/config`).expect(200)
    f.archive.request.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            '0020000D': { vr: 'UI', Value: ['1.2.10.1'] },
            '00080018': { vr: 'UI', Value: ['1.2.10.3'] },
          },
          {
            '0020000D': { vr: 'UI', Value: ['9.9.9'] },
            '00080018': { vr: 'UI', Value: ['9.9.10'] },
          },
        ]),
        { headers: { 'Content-Type': 'application/dicom+json' } },
      ),
    )
    const selected = await f.database.query<Array<{ studyUid: string }>>(
      'SELECT study_uid AS "studyUid" FROM dicom_studies WHERE exam_id=$1',
      [existing.examId],
    )
    const result = await request(f.server)
      .get(`/api/v1/dicom-viewer/${token}/dicom-web/studies/${selected[0]!.studyUid}/metadata`)
      .expect(200)
    expect(JSON.stringify(result.body)).not.toContain('9.9.10')
    await request(f.server)
      .get(`/api/v1/dicom-viewer/${token}/dicom-web/studies/9.9.9/metadata`)
      .expect(403)
  })
  it('restricts machine credentials to ingestion in one unit and supports revocation', async () => {
    const source = responseBody<{ id: string; token: string }>(
      await f
        .api('post', '/dicom-sources')
        .send({ unitId: f.unit, name: 'Receptor sintético' })
        .expect(201),
    )
    const bytes = syntheticDicom({ study: '1.2.88.1', series: '1.2.88.2', instance: '1.2.88.3' })
    const input = {
      kind: 'DICOM',
      unitId: f.unit,
      name: 'test.dcm',
      contentType: 'application/dicom',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    await f
      .api('post', '/uploads')
      .send({ ...input, sourceId: source.id })
      .expect(400)
    await request(f.server)
      .post('/api/v1/dicom-agent/uploads')
      .set('Authorization', 'Bearer ' + source.token)
      .send({ ...input, unitId: f.secondUnit })
      .expect(400)
    const created = responseBody<{ id: string }>(
      await request(f.server)
        .post('/api/v1/dicom-agent/uploads')
        .set('Authorization', 'Bearer ' + source.token)
        .send(input)
        .expect(201),
    )
    const persisted = await f.database
      .getRepository(UploadSessionEntity)
      .findOneByOrFail({ id: created.id })
    f.pending.get(persisted.multipartId)!.parts.set(1, bytes)
    await request(f.server)
      .post(`/api/v1/dicom-agent/uploads/${created.id}/complete`)
      .set('Authorization', 'Bearer ' + source.token)
      .expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    expect(
      (await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: created.id }))
        .status,
    ).toBe('PUBLISHED')
    await request(f.server)
      .get('/api/v1/exams')
      .set('Authorization', 'Bearer ' + source.token)
      .expect(401)
    await f.api('post', `/dicom-sources/${source.id}/revoke`).expect(201)
    await request(f.server)
      .post('/api/v1/dicom-agent/heartbeat')
      .set('Authorization', 'Bearer ' + source.token)
      .send({ version: '0.1.0', pending: 0, failed: 0, freeBytes: 1 })
      .expect(401)
  })
  it('rolls back exam, patient, study and instance together if ingestion auditing fails', async () => {
    const audit = f.app.get(OperationalAuditService),
      original = audit.record.bind(audit)
    const failed = jest.spyOn(audit, 'record').mockImplementation((context, event, manager) => {
      if (event.action === 'DICOM_INSTANCE_RECEIVED')
        return Promise.reject(new Error('Synthetic audit failure'))
      return original(context, event, manager)
    })
    const held = await upload(
      syntheticDicom({
        study: '1.2.99.1',
        series: '1.2.99.2',
        instance: '1.2.99.3',
        patient: 'UNIQUE-ROLLBACK',
      }),
    )
    failed.mockRestore()
    expect(held.status).toBe('QUARANTINED')
    expect(
      await f.database.query('SELECT id FROM dicom_studies WHERE study_uid=$1', ['1.2.99.1']),
    ).toEqual([])
    expect(
      await f.database.query('SELECT id FROM exams WHERE source_exam_id=$1', ['1.2.99.1']),
    ).toEqual([])
    await f.api('post', `/uploads/${held.id}/reprocess`).expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    expect(
      responseBody<{ status: string }>(await f.api('get', `/uploads/${held.id}`).expect(200))
        .status,
    ).toBe('PUBLISHED')
  })
  it('delivers a scoped ZIP with a manifest and rejects an expired ticket', async () => {
    const target = await upload(
      syntheticDicom({
        study: '1.2.111.1',
        series: '1.2.111.2',
        instance: '1.2.111.3',
        patient: 'ZIP-SYNTHETIC',
      }),
    )
    const ticket = responseBody<{ url: string }>(
      await f.api('post', `/exams/${target.examId}/images/download`).expect(201),
    )
    const path = new URL(ticket.url).pathname
    const audit = f.app.get(OperationalAuditService),
      original = audit.record.bind(audit)
    let delivered: () => void = () => {}
    const delivery = new Promise<void>((resolve) => {
      delivered = resolve
    })
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (context, event, manager) => {
      const result = await original(context, event, manager)
      if (event.action === 'DICOM_DOWNLOAD_DELIVERED') delivered()
      return result
    })
    const response = await request(f.server)
      .get(path)
      .buffer(true)
      .parse((message: request.Response, done: (error: Error | null, data: unknown) => void) => {
        const chunks: Buffer[] = []
        message.on('data', (chunk: Buffer) => chunks.push(chunk))
        message.on('end', () => done(null, Buffer.concat(chunks)))
        message.on('error', (error: Error) => done(error, undefined))
      })
      .expect(200)
    await delivery
    spy.mockRestore()
    const bytes = responseBody<Buffer>(response)
    expect(bytes.subarray(0, 2).toString()).toBe('PK')
    expect(bytes.includes(Buffer.from('manifest.json'))).toBe(true)
    expect(bytes.includes(Buffer.from('1.2.111.1/1.2.111.2/1.2.111.3.dcm'))).toBe(true)
    await f.database.query("UPDATE dicom_viewer_grants SET expires_at=now()-interval '1 second'")
    await request(f.server).get(path).expect(401)
    await f
      .api('post', `/exams/${target.examId}/images/download`)
      .set('X-Unit-Id', f.secondUnit)
      .expect(404)
  })
})
