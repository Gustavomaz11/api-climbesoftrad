import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { CreateBucketCommand } from '@aws-sdk/client-s3'
import request from 'supertest'
import { R2ObjectStorage } from '../src/modules/exams/r2-object-storage.service'
import { R2MultipartStorage } from '../src/modules/file-validation/r2-multipart-storage.service'
import { ClamAvScanner } from '../src/modules/file-validation/clamav-scanner.service'
import { OrthancArchiveService } from '../src/modules/dicom/orthanc-archive.service'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticDicom, syntheticPdf } from './synthetic-documents'
import { uploadPartSize } from '../src/modules/document-uploads/upload.policy'
const integration = process.env.SOURAD_DICOM_QA_CONFIG ? describe : describe.skip
integration('Real S3 SDK, ClamAV, Orthanc and DICOMweb (synthetic data)', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let exam: { id: string; patientId: string }
  let qaSettings: Record<string, unknown>
  const upload = async (bytes: Buffer, kind: string) => {
    const created = responseBody<{ id: string }>(
      await f
        .api('post', '/uploads')
        .send({
          kind,
          unitId: f.unit,
          name: kind === 'DICOM' ? 'qa.dcm' : 'qa.pdf',
          contentType: kind === 'DICOM' ? 'application/dicom' : 'application/pdf',
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          ...(kind === 'ATTACHMENT' ? { examId: exam.id, category: 'ORDER' } : {}),
        })
        .expect(201),
    )
    for (let number = 1; number <= Math.ceil(bytes.length / uploadPartSize); number++) {
      const signed = responseBody<{ url: string }>(
        await f.api('post', `/uploads/${created.id}/parts/${number}`).expect(201),
      )
      if(kind==='ATTACHMENT') await f.api('put',`/uploads/${created.id}/parts/${number}`).set('Content-Type','application/octet-stream').send(bytes.subarray((number-1)*uploadPartSize,number*uploadPartSize)).expect(200)
      else {
        const response=await fetch(signed.url,{method:'PUT',body:Uint8Array.from(bytes.subarray((number-1)*uploadPartSize,number*uploadPartSize))})
        expect(response.ok).toBe(true)
      }
      if(kind==='ATTACHMENT'&&number===1&&bytes.length>uploadPartSize){
        expect(responseBody<{parts:unknown[]}>(await f.api('get',`/uploads/${created.id}`).expect(200)).parts).toHaveLength(1)
        await f.api('post',`/uploads/${created.id}/complete`).expect(409)
      }
    }
    await f.api('post', `/uploads/${created.id}/complete`).expect(201)
    await f.app.get(ImageIngestionWorker).runBatch()
    return responseBody<{ status: string; examId: string }>(
      await f.api('get', `/uploads/${created.id}`).expect(200),
    )
  }
  beforeAll(async () => {
    const settings = JSON.parse(
      await readFile(process.env.SOURAD_DICOM_QA_CONFIG!, 'utf8'),
    ) as Record<string, unknown>
    qaSettings = settings
    const config = new ConfigService({
      CLOUDFLARE_R2_ENDPOINT: 'http://localhost:9900',
      CLOUDFLARE_R2_BUCKET: 'sourad-qa',
      CLOUDFLARE_R2_REGION: 'us-east-1',
      CLOUDFLARE_R2_ACCESS_KEY: 'synthetic-access',
      CLOUDFLARE_R2_SECRET_KEY: 'synthetic-secret',
      OBJECT_STORAGE_FORCE_PATH_STYLE: true,
      CLAMAV_HOST: settings.clamavHost,
      CLAMAV_PORT: settings.clamavPort,
      ORTHANC_INTERNAL_URL: settings.orthancUrl,
      ORTHANC_USERNAME: settings.orthancUsername,
      ORTHANC_PASSWORD: settings.orthancPassword,
    })
    const objects = new R2ObjectStorage(config),
      multipart = new R2MultipartStorage(objects),
      scanner = new ClamAvScanner(config),
      archive = new OrthancArchiveService(config)
    await objects.getClient().send(new CreateBucketCommand({ Bucket: objects.bucket }))
    f = await createOperationalDocumentsFixture({ objects, multipart, scanner, archive })
    f.app.get(ConfigService).set('OHIF_VIEWER_URL', 'http://localhost:8050/viewer')
    exam = await f.exam()
  }, 60000)
  afterAll(async () => {
    await f?.app.close()
  })
  it('uploads a large document with real signed parts and scans the complete stored bytes', async () => {
    const pdf = Buffer.concat([await syntheticPdf(), Buffer.alloc(uploadPartSize, ' ')])
    expect((await upload(pdf, 'ATTACHMENT')).status).toBe('PUBLISHED')
  }, 60000)
  it('ingests a real Part 10 object, serves scoped metadata and renders a frame through Orthanc', async () => {
    const result = await upload(
      syntheticDicom({
        study: '1.2.826.0.1.3680043.10.777.1',
        series: '1.2.826.0.1.3680043.10.777.2',
        instance: '1.2.826.0.1.3680043.10.777.3',
      }),
      'DICOM',
    )
    expect(result.status).toBe('PUBLISHED')
    const images = responseBody<{ items: Array<{ archived: number }> }>(
      await f.api('get', `/exams/${result.examId}/images`).expect(200),
    )
    expect(images.items[0]?.archived).toBe(1)
    const grant = responseBody<{ url: string }>(
      await f.api('post', `/exams/${result.examId}/images/viewer`).send({}).expect(201),
    )
    const token = new URL(new URL(grant.url).searchParams.get('configUrl')!).pathname.split('/')[4]!
    const metadata = await request(f.server)
      .get(`/api/v1/dicom-viewer/${token}/dicom-web/studies/1.2.826.0.1.3680043.10.777.1/metadata`)
      .expect(200)
    expect(
      responseBody<Array<Record<string, { Value?: string[] }>>>(metadata).map(
        (row) => row['00080018']?.Value?.[0],
      ),
    ).toContain('1.2.826.0.1.3680043.10.777.3')
    await request(f.server)
      .get(
        `/api/v1/dicom-viewer/${token}/dicom-web/studies/1.2.826.0.1.3680043.10.777.1/series/1.2.826.0.1.3680043.10.777.2/instances/1.2.826.0.1.3680043.10.777.3/frames/1`,
      )
      .set('Accept', 'multipart/related; type="application/octet-stream"; transfer-syntax=*')
      .expect(200)
  }, 60000)
  it('runs the packaged agent, confirms durable delivery and recovers its queue after restart', async () => {
    await f.app.listen(3308, '127.0.0.1')
    const source = responseBody<{ id: string; token: string }>(
      await f
        .api('post', '/dicom-sources')
        .send({ unitId: f.unit, name: 'Receptor QA' })
        .expect(201),
    )
    const qaDirectory = dirname(process.env.SOURAD_DICOM_QA_CONFIG!),
      dataDirectory = join(qaDirectory, 'agent-qa-' + source.id)
    await mkdir(dataDirectory, { recursive: true })
    const configPath = join(qaDirectory, 'agent-qa-config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        apiUrl: 'http://127.0.0.1:3308/api/v1',
        unitId: f.unit,
        token: source.token,
        orthancUrl: qaSettings.receiverUrl,
        orthancUsername: qaSettings.orthancUsername,
        orthancPassword: qaSettings.orthancPassword,
        dataDirectory,
        localDevelopment: true,
        minFreeBytes: 64 * 1024 * 1024,
        pollSeconds: 1,
      }),
    )
    const received = await fetch(String(qaSettings.receiverUrl) + '/instances', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(
            String(qaSettings.orthancUsername) + ':' + String(qaSettings.orthancPassword),
          ).toString('base64'),
        'Content-Type': 'application/dicom',
      },
      body: Uint8Array.from(
        syntheticDicom({
          study: '1.2.826.0.1.3680043.10.888.1',
          series: '1.2.826.0.1.3680043.10.888.2',
          instance: '1.2.826.0.1.3680043.10.888.3',
          patient: 'AGENT-QA',
        }),
      ),
    })
    expect(received.ok).toBe(true)
    const script = resolve('../agent/src/service.mjs'),
      env = { ...process.env, SOURAD_AGENT_CONFIG: configPath }
    const agent = spawn(process.execPath, [script], { env, windowsHide: true, stdio: 'ignore' })
    try {
      let delivered = false,
        observedPending = false
      for (let attempt = 0; attempt < 40; attempt++) {
        await f.app.get(ImageIngestionWorker).runBatch()
        const rows = await f.database.query<Array<{ status: string }>>(
          'SELECT status FROM upload_sessions WHERE source_id=$1',
          [source.id],
        )
        const [state] = await f.database.query<Array<{ pending: number }>>(
          "SELECT (diagnostics->>'pending')::int AS pending FROM dicom_sources WHERE id=$1",
          [source.id],
        )
        if (state && state.pending > 0) observedPending = true
        if (rows.some((x) => x.status === 'PUBLISHED') && observedPending && state?.pending === 0) {
          delivered = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      expect(delivered).toBe(true)
    } finally {
      agent.kill()
      await new Promise<void>((resolve) => agent.once('exit', () => resolve()))
    }
    const diagnostic = await promisify(execFile)(process.execPath, [script, '--diagnose'], {
      env,
      windowsHide: true,
    })
    expect(JSON.parse(diagnostic.stdout) as unknown).toMatchObject({
      version: '0.1.0',
      connected: true,
      pending: 0,
      failed: 0,
    })
    const studies = await f.database.query<Array<{ count: number }>>(
      'SELECT count(*)::int AS count FROM dicom_studies WHERE study_uid=$1',
      ['1.2.826.0.1.3680043.10.888.1'],
    )
    expect(studies[0]?.count).toBe(1)
  }, 60000)
})
