import { createHash } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import request from 'supertest'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticDicom } from './synthetic-documents'

describe('DICOM viewing in the hospital before submission (e2e)', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let intake: { id: string; version: number }, uploadId: string, otherCompany: string
  const studyUid = '1.2.826.0.1.3680043.10.800.1', seriesUid = '1.2.826.0.1.3680043.10.800.2', instanceUid = '1.2.826.0.1.3680043.10.800.3'
  beforeAll(async () => {
    f = await createOperationalDocumentsFixture()
    f.app.get(ConfigService).set('OHIF_VIEWER_URL', 'http://localhost:8050')
    otherCompany = responseBody<{ id: string }>(await f.api('post', '/companies').send({ name: 'Empresa sem acesso ao rascunho' }).expect(201)).id
    const bytes = syntheticDicom({ study: studyUid, series: seriesUid, instance: instanceUid })
    uploadId = responseBody<{ id: string }>(await f.api('post', '/uploads').send({ kind: 'DICOM', hospitalIntake: true, unitId: f.unit, name: 'synthetic.dcm', contentType: 'application/dicom', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }).expect(201)).id
    const upload = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: uploadId })
    f.pending.get(upload.multipartId)!.parts.set(1, bytes)
    await f.api('post', `/uploads/${uploadId}/complete`).expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    intake = responseBody<Array<typeof intake>>(await f.api('get', '/hospital/intakes').expect(200))[0]!
  }, 30000)
  afterAll(async () => { await f?.app.close() })
  const open = async () => {
    const result = responseBody<{ url: string; expiresAt: string }>(await f.api('post', `/hospital/intakes/${intake.id}/images/viewer`).expect(201))
    const url = new URL(result.url), token = new URL(url.searchParams.get('configUrl')!).pathname.split('/')[4]!
    return { url, token }
  }
  it('opens the draft in OHIF without creating an exam or forwarding files; reuses prepared images', async () => {
    const { url, token } = await open()
    expect(url.pathname).toBe('/viewer')
    expect(url.searchParams.get('StudyInstanceUIDs')).toBe(studyUid)
    const config = responseBody<{ showStudyList: boolean }>(await request(f.server).get(`/api/v1/dicom-viewer/${token}/config`).expect(200))
    expect(config.showStudyList).toBe(false)
    await request(f.server).get(`/api/v1/dicom-viewer/${token}/research/exams/00000000-0000-4000-9000-000000000111/cases`).expect(403)
    expect(responseBody<{ total: number }>(await f.api('get', '/exams').expect(200)).total).toBe(0)
    const draft = responseBody<{ status: string; examId: string | null; version: number }>(await f.api('get', `/hospital/intakes/${intake.id}`).expect(200))
    expect(draft).toMatchObject({ status: 'DRAFT', examId: null, version: intake.version })
    const upload = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id: uploadId })
    expect(upload.status).toBe('AWAITING_REVIEW')
    expect(upload.previewOrthancId).toBeTruthy()
    const before = f.archive.store.mock.calls.length
    await open()
    expect(f.archive.store).toHaveBeenCalledTimes(before)
  })
  it('authorizes metadata and frames only for the draft snapshot and blocks other companies/units', async () => {
    await f.api('post', `/hospital/intakes/${intake.id}/images/viewer`, otherCompany).expect(404)
    await f.api('post', `/hospital/intakes/${intake.id}/images/viewer`).set('X-Unit-Id', f.secondUnit).expect(404)
    const { token } = await open()
    f.archive.request.mockResolvedValueOnce(new Response(JSON.stringify([
      { '0020000D': { vr: 'UI', Value: [studyUid] }, '0020000E': { vr: 'UI', Value: [seriesUid] }, '00080018': { vr: 'UI', Value: [instanceUid] } },
      { '0020000D': { vr: 'UI', Value: [studyUid] }, '0020000E': { vr: 'UI', Value: ['9.9.9.1'] }, '00080018': { vr: 'UI', Value: ['9.9.9.2'] } },
    ])))
    const response = await request(f.server).get(`/api/v1/dicom-viewer/${token}/dicom-web/studies/${studyUid}/metadata`).expect(200)
    expect(responseBody<unknown[]>(response)).toHaveLength(1)
    expect(JSON.stringify(response.body)).not.toContain('9.9.9.2')
    f.archive.request.mockResolvedValueOnce(new Response(Buffer.from([0, 1]), { headers: { 'Content-Type': 'application/octet-stream' } }))
    await request(f.server).get(`/api/v1/dicom-viewer/${token}/dicom-web/studies/${studyUid}/series/${seriesUid}/instances/${instanceUid}/frames/1`).expect(200)
    await request(f.server).get(`/api/v1/dicom-viewer/${token}/dicom-web/studies/9.9.9/metadata`).expect(403)
    await request(f.server).get(`/api/v1/dicom-viewer/${token}/dicom-web/studies/${studyUid}/series/${seriesUid}/instances/9.9.9/frames/1`).expect(403)
    await request(f.server).get(`/api/v1/dicom-download/${token}`).expect(403)
  })
  it('expires access and revalidates the original company/unit permissions on every request', async () => {
    const { token } = await open()
    await f.database.query("UPDATE dicom_viewer_grants SET expires_at=now()-interval '1 second'")
    await request(f.server).get(`/api/v1/dicom-viewer/${token}/config`).expect(401)
    const renewed = await open()
    await f.database.query('UPDATE hospital_units SET active=false WHERE id=$1', [f.unit])
    await request(f.server).get(`/api/v1/dicom-viewer/${renewed.token}/config`).expect(404)
  })
})
