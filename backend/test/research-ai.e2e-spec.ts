import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import sharp from 'sharp'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { DicomStudyEntity } from '../src/database/entities/dicom-study.entity'
import { DicomSeriesEntity } from '../src/database/entities/dicom-series.entity'
import { DicomInstanceEntity } from '../src/database/entities/dicom-instance.entity'
import { StoredObjectEntity } from '../src/database/entities/stored-object.entity'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { ResearchAiWorker } from '../src/modules/research-ai/research-ai.worker'
import { ResearchAiService } from '../src/modules/research-ai/research-ai.service'
import { ResearchReanalysisService } from '../src/modules/research-ai/research-reanalysis.service'
import { ResearchFrameReviewService } from '../src/modules/research-ai/research-frame-review.service'
import type { CompanyAccessContext } from '../src/modules/companies/company-context.contracts'
import { GeminiResearchClient } from '../src/modules/research-ai/gemini-research.client'
import { LocalTextRedactionService } from '../src/modules/research-ai/local-text-redaction.service'

interface Case {
  canRetry: boolean
  sourceCaseId: string | null
  promptVersion: string
  batchesCompleted: number
  id: string
  status: string
  framesExpected: number
  framesPrepared: number
  result: unknown
  errorCode: string | null
  feedback: { useful: boolean; comment: string } | null
  frames: Array<{ id: string; revision: number; reviewed: boolean }>
}
describe('Isolated research AI workflow (e2e)', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>,
    examId: string,
    studyId: string,
    seriesId: string,
    userId: string,
    png: Buffer,
    job: Case
  let analyze: jest.SpyInstance, ocr: jest.SpyInstance
  const root = (id = job.id) => `/research-ai/cases/${id}`
  const get = async () => responseBody<Case>(await f.api('get', root()).expect(200))
  const instance = async () => {
    const object = await f.database.getRepository(StoredObjectEntity).save({
      companyId: initialCompanyId,
      examId,
      storageKey: randomUUID(),
      originalName: 'PRIVATE_PATIENT.dcm',
      contentType: 'application/dicom',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
      status: 'STORED',
      createdByUserId: userId,
    })
    return f.database.getRepository(DicomInstanceEntity).save({
      companyId: initialCompanyId,
      unitId: f.unit,
      studyId,
      seriesId,
      instanceUid: `2.25.${Date.now()}${Math.floor(Math.random() * 100000)}`,
      objectId: object.id,
      orthancId: randomUUID(),
    })
  }
  const prepare = async () => {
    job = responseBody<Case>(await f.api('post', `/research-ai/exams/${examId}/cases`).expect(201))
    await f.app.get(ResearchAiWorker).tick()
    job = await get()
  }
  const approve = async () => {
    for (const frame of job.frames)
      await f
        .api('patch', `${root()}/frames/${frame.id}/review`)
        .send({ expectedRevision: frame.revision, reviewed: true })
        .expect(200)
  }
  beforeAll(async () => {
    f = await createOperationalDocumentsFixture()
    const config = f.app.get(ConfigService)
    config.set('GEMINI_RESEARCH_ENABLED', true)
    config.set('GEMINI_RESEARCH_IMAGES_PER_REQUEST', 4)
    config.set('GEMINI_API_KEY', 'test-key-never-sent')
    config.set('OHIF_VIEWER_URL', 'http://localhost:8050')
    analyze = jest
      .spyOn(f.app.get(GeminiResearchClient), 'analyze')
      .mockImplementation((images: Array<{ id: string; png: Buffer }>) =>
        Promise.resolve({
          summary: 'Padrões sintéticos para pesquisa.',
          limitations: ['Sem finalidade clínica.'],
          imagesReviewed: images.map((i) => i.id),
          imageAssessments: images.map((i, index) => ({
            imageId: i.id,
            localizationStatus: index === 0 ? 'LOCALIZED' : 'NO_LOCALIZATION',
            description: 'Avaliação individual sintética.',
          })),
          findings: [
            {
              imageId: images[0]!.id,
              label: 'Região sintética',
              description: 'Revisar contraste desta forma.',
              box: [200, 200, 500, 500],
            },
          ],
        }),
      )
    ocr = jest
      .spyOn(f.app.get(LocalTextRedactionService), 'detect')
      .mockResolvedValue([{ x: 0, y: 0, width: 1, height: 0.1 }])
    png = await sharp({ create: { width: 120, height: 100, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    f.archive.request.mockImplementation((path) =>
      Promise.resolve(
        path.endsWith('/frames') ? new Response('[0,1]') : new Response(new Uint8Array(png)),
      ),
    )
    examId = (await f.exam()).id
    ;[{ id: userId }] = await f.database.query('SELECT id FROM auth_users LIMIT 1')
    studyId = (
      await f.database.getRepository(DicomStudyEntity).save({
        companyId: initialCompanyId,
        unitId: f.unit,
        examId,
        studyUid: '2.25.91000',
        identityHash: 'b'.repeat(64),
        lastReceivedAt: new Date(),
      })
    ).id
    seriesId = (
      await f.database.getRepository(DicomSeriesEntity).save({
        companyId: initialCompanyId,
        unitId: f.unit,
        studyId,
        seriesUid: '2.25.91001',
        modality: 'CT',
      })
    ).id
    await instance()
    await instance()
  }, 30000)
  afterAll(async () => {
    await f?.app.close()
  })
  it('requires normal authentication and exam/unit authorization', async () => {
    await request(f.server).post(`/api/v1/research-ai/exams/${examId}/cases`).expect(401)
    await f
      .api('post', `/research-ai/exams/${examId}/cases`)
      .set('X-Unit-Id', f.secondUnit)
      .expect(404)
    await f.api('get', `/research-ai/exams/${randomUUID()}/cases`).expect(404)
  })
  it('prepares every frame and keeps Gemini blocked before human review; creation is idempotent', async () => {
    job = responseBody<Case>(await f.api('post', `/research-ai/exams/${examId}/cases`).expect(201))
    expect(
      responseBody<Case>(await f.api('post', `/research-ai/exams/${examId}/cases`).expect(201)).id,
    ).toBe(job.id)
    await f.app.get(ResearchAiWorker).tick()
    job = await get()
    expect(job.status).toBe('REVIEW')
    expect(job.framesExpected).toBe(4)
    expect(job.framesPrepared).toBe(4)
    expect(job.frames).toHaveLength(4)
    expect(ocr).toHaveBeenCalledTimes(4)
    expect(analyze).not.toHaveBeenCalled()
    expect(JSON.stringify(job)).not.toContain('PRIVATE_PATIENT')
    expect(JSON.stringify(job)).not.toContain('base_key')
    await f
      .api('post', `${root()}/run`)
      .send({ confirmsAnonymization: false, nonClinicalResearch: true })
      .expect(400)
    await f
      .api('post', `${root()}/run`)
      .send({ confirmsAnonymization: true, nonClinicalResearch: true })
      .expect(409)
  })
  it('saves opaque masks, invalidates prior approval and rejects stale/out of bounds edits', async () => {
    const frame = job.frames[0]!
    await f
      .api('patch', `${root()}/frames/${frame.id}/review`)
      .send({ expectedRevision: 1, reviewed: true })
      .expect(200)
    await f
      .api('put', `${root()}/frames/${frame.id}/masks`)
      .send({ expectedRevision: 1, masks: [{ x: 0.9, y: 0, width: 0.5, height: 0.1 }] })
      .expect(400)
    job = responseBody<Case>(
      await f
        .api('put', `${root()}/frames/${frame.id}/masks`)
        .send({ expectedRevision: 1, masks: [{ x: 0, y: 0, width: 1, height: 0.3 }] })
        .expect(200),
    )
    expect(job.frames[0]).toMatchObject({ revision: 2, reviewed: false })
    await f
      .api('patch', `${root()}/frames/${frame.id}/review`)
      .send({ expectedRevision: 1, reviewed: true })
      .expect(409)
    const response = await f
      .api('get', `${root()}/frames/${frame.id}/image`)
      .expect(200)
      .expect('Cache-Control', 'private, no-store')
    const pixel = await sharp(response.body as Buffer)
      .extract({ left: 50, top: 15, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()
    expect([...pixel].every((n) => n === 0)).toBe(true)
    await f
      .api('get', `${root()}/frames/${frame.id}/image`)
      .set('X-Unit-Id', f.secondUnit)
      .expect(404)
  })
  it('sends only reviewed image bytes and links all returned regions to the correct frames', async () => {
    await approve()
    const before = await f.database.query<
      Array<{ workflow_version: number; evidence_version: number }>
    >('SELECT workflow_version,evidence_version FROM exams WHERE id=$1', [examId])
    job = responseBody<Case>(
      await f
        .api('post', `${root()}/run`)
        .send({ confirmsAnonymization: true, nonClinicalResearch: true })
        .expect(201),
    )
    expect(job.status).toBe('QUEUED')
    await f
      .api('put', `${root()}/frames/${job.frames[0]!.id}/masks`)
      .send({ expectedRevision: 2, masks: [] })
      .expect(409)
    await f.app.get(ResearchAiWorker).tick()
    job = await get()
    expect(job.status).toBe('COMPLETED')
    expect(analyze).toHaveBeenCalledTimes(1)
    const [images] = analyze.mock.calls[0] as [Array<{ id: string; png: Buffer }>]
    expect(images.map((i) => i.id)).toEqual(job.frames.map((frame) => frame.id))
    expect(Object.keys(images[0]!)).toEqual(['id', 'png'])
    expect(
      await f.database.query('SELECT workflow_version,evidence_version FROM exams WHERE id=$1', [
        examId,
      ]),
    ).toEqual(before)
    expect(job.result).toMatchObject({
      findings: [{ imageId: job.frames[0]!.id, description: 'Revisar contraste desta forma.' }],
    })
  })
  it('persists one editable feedback per researcher/version without another Gemini request', async () => {
    await f
      .api('post', `${root()}/feedback`)
      .send({ useful: true, comment: 'Região bem localizada' })
      .expect(201)
    await f
      .api('post', `${root()}/feedback`)
      .send({ useful: false, comment: 'Precisa revisar' })
      .expect(201)
    expect((await get()).feedback).toEqual({ useful: false, comment: 'Precisa revisar' })
    expect(
      (
        await f.database.query<Array<{ case_id: string }>>(
          'SELECT * FROM research_ai_feedback WHERE case_id=$1',
          [job.id],
        )
      ).length,
    ).toBe(1)
    expect(analyze).toHaveBeenCalledTimes(1)
  })
  it('adds a research link to the scoped clinical viewer without forwarding its token', async () => {
    const viewer = responseBody<{ url: string }>(
      await f.api('post', `/exams/${examId}/images/viewer`).expect(201),
    )
    const configUrl = new URL(viewer.url).searchParams.get('configUrl')!,
      path = new URL(configUrl).pathname
    const config = responseBody<{ souradResearch: { exams: Array<{ url: string }> } }>(
      await request(f.server).get(path).expect(200),
    )
    expect(config.souradResearch.exams[0]!.url).toBe(
      `http://localhost:5173/research/exams/${examId}`,
    )
  })
  it('supports the inline OHIF panel with a study-scoped capability and explicit mutation origin', async () => {
    const viewer = responseBody<{ url: string }>(
      await f.api('post', `/exams/${examId}/images/viewer`).expect(201),
    )
    const configPath = new URL(new URL(viewer.url).searchParams.get('configUrl')!).pathname
    const base = configPath.replace(/\/config$/, '/research')
    await request(f.server).get(`${base}/exams/${examId}/cases`).expect(200)
    await request(f.server).post(`${base}/exams/${examId}/cases`).send({}).expect(403)
    await request(f.server)
      .post(`${base}/exams/${examId}/cases`)
      .set('Origin', 'https://untrusted.test')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({})
      .expect(403)
    job = responseBody<Case>(
      await request(f.server)
        .post(`${base}/exams/${examId}/cases`)
        .set('Origin', 'http://localhost:8050')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({})
        .expect(201),
    )
    await f.app.get(ResearchAiWorker).tick()
    job = await get()
    const scoped = responseBody<
      Case & { frames: Array<{ instanceUid: string; studyUid: string; frameIndex: number }> }
    >(await request(f.server).get(`${base}/cases/${job.id}`).expect(200))
    expect(scoped.frames[0]!.studyUid).toBe('2.25.91000')
    expect(scoped.frames[0]!.instanceUid).toMatch(/^2\.25\./)
    expect(scoped.frames[0]!.frameIndex).toBe(0)
    await request(f.server)
      .get(`${base}/cases/${job.id}/frames/${job.frames[0]!.id}/image?original=1`)
      .expect(200)
    const otherExam = (await f.exam()).id
    await request(f.server).get(`${base}/exams/${otherExam}/cases`).expect(404)
    const otherCase = randomUUID()
    await f.database.query(
      `INSERT INTO research_ai_cases(id,company_id,unit_id,exam_id,created_by_user_id,context,source_hash,source_snapshot,status,model,prompt_version,anonymization_version)
      SELECT $2,company_id,unit_id,$3,created_by_user_id,context,source_hash,source_snapshot,'COMPLETED',model,prompt_version,anonymization_version FROM research_ai_cases WHERE id=$1`,
      [job.id, otherCase, otherExam],
    )
    await f.api('get', root(otherCase)).expect(200)
    await request(f.server).get(`${base}/cases/${otherCase}`).expect(404)
    await f.database.query(
      "UPDATE dicom_viewer_grants SET expires_at=now()-interval '1 second' WHERE token_hash IS NOT NULL",
    )
    await request(f.server).get(`${base}/cases/${job.id}`).expect(401)
    expect(analyze).toHaveBeenCalledTimes(1)
  })
  it('replaces unfinished research made with the previous anonymization algorithm', async () => {
    const oldId = job.id
    await f.database.query(
      "UPDATE research_ai_cases SET anonymization_version='png-local-ocr-human-1' WHERE id=$1",
      [oldId],
    )
    job = responseBody<Case>(await f.api('post', `/research-ai/exams/${examId}/cases`).expect(201))
    expect(job.id).not.toBe(oldId)
    expect(responseBody<Case>(await f.api('get', root(oldId)).expect(200)).status).toBe('STALE')
  })
  it('blocks stale snapshots before any external request', async () => {
    await prepare()
    await approve()
    await f
      .api('post', `${root()}/run`)
      .send({ confirmsAnonymization: true, nonClinicalResearch: true })
      .expect(201)
    await instance()
    await f.app.get(ResearchAiWorker).tick()
    job = await get()
    expect(job.status).toBe('STALE')
    expect(job.result).toBeNull()
    expect(analyze).toHaveBeenCalledTimes(1)
  })
  it('rejects oversized studies without silently selecting a subset', async () => {
    f.app.get(ConfigService).set('GEMINI_RESEARCH_MAX_FRAMES', 2)
    await prepare()
    expect(job.status).toBe('FAILED')
    expect(job.errorCode).toBe('FRAME_LIMIT_EXCEEDED')
    expect(job.frames).toHaveLength(0)
    expect(analyze).toHaveBeenCalledTimes(1)
  })
  it('records quota failures without exposing partial results or retrying automatically', async () => {
    f.app.get(ConfigService).set('GEMINI_RESEARCH_MAX_FRAMES', 200)
    await prepare()
    await approve()
    analyze.mockRejectedValueOnce(new Error('GEMINI_QUOTA_EXCEEDED'))
    await f
      .api('post', `${root()}/run`)
      .send({ confirmsAnonymization: true, nonClinicalResearch: true })
      .expect(201)
    await f.app.get(ResearchAiWorker).tick()
    job = await get()
    expect(job.status).toBe('FAILED')
    expect(job.errorCode).toBe('GEMINI_QUOTA_EXCEEDED')
    expect(job.result).toBeNull()
    await f.app.get(ResearchAiWorker).tick()
    expect(analyze).toHaveBeenCalledTimes(2)
    await f.api('post', `${root()}/feedback`).send({ useful: true }).expect(409)
  })
  it('detects changed derivative bytes before sending them externally', async () => {
    await prepare()
    await approve()
    await f
      .api('post', `${root()}/run`)
      .send({ confirmsAnonymization: true, nonClinicalResearch: true })
      .expect(201)
    const [row] = await f.database.query<Array<{ redacted_key: string }>>(
      'SELECT redacted_key FROM research_ai_frames WHERE case_id=$1 ORDER BY sequence LIMIT 1',
      [job.id],
    )
    f.stored.set(row!.redacted_key, { body: Buffer.from('changed bytes') })
    await f.app.get(ResearchAiWorker).tick()
    job = await get()
    expect(job.status).toBe('FAILED')
    expect(job.errorCode).toBe('IMAGE_CHANGED')
    expect(analyze).toHaveBeenCalledTimes(2)
  })
  it('analyzes every frame over multiple groups with complete final coverage', async () => {
    await prepare()
    await approve()
    await f
      .api('post', `${root()}/run`)
      .send({ confirmsAnonymization: true, nonClinicalResearch: true })
      .expect(201)
    await f.app.get(ResearchAiWorker).tick()
    job = await get()
    expect(job.status).toBe('COMPLETED')
    expect(job.framesExpected).toBe(6)
    const result = job.result as { imagesReviewed: string[]; findings: unknown[] }
    expect(result.imagesReviewed).toEqual(job.frames.map((frame) => frame.id))
    expect(result.findings).toHaveLength(2)
    expect(analyze).toHaveBeenCalledTimes(4)
  })
  it('resumes only missing images after a transport failure, preserving approval and completed groups', async () => {
    const [saved] = await f.database.query<Array<{ context: CompanyAccessContext }>>(
      'SELECT context FROM research_ai_cases WHERE id=$1',
      [job.id],
    )
    const context = saved!.context,
      service = f.app.get(ResearchAiService),
      reviewer = f.app.get(ResearchFrameReviewService)
    job = await service.create(examId, context)
    await f.app.get(ResearchAiWorker).tick()
    job = await service.get(job.id, context)
    for (const frame of job.frames)
      await reviewer.review(
        job.id,
        frame.id,
        { expectedRevision: frame.revision, reviewed: true },
        context,
      )
    const firstJobId = job.id,
      frameIds = job.frames.map((f) => f.id),
      callsBefore = analyze.mock.calls.length,
      ocrBefore = ocr.mock.calls.length
    analyze
      .mockImplementationOnce((images: Array<{ id: string }>) =>
        Promise.resolve({
          summary: 'Grupo concluído.',
          limitations: [],
          imagesReviewed: images.map((i) => i.id),
          imageAssessments: images.map((i) => ({
            imageId: i.id,
            localizationStatus: 'NO_LOCALIZATION',
            description: 'Sem região localizada no teste.',
          })),
          findings: [],
        }),
      )
      .mockRejectedValueOnce(new Error('GEMINI_TIMEOUT'))
    await service.run(job.id, { confirmsAnonymization: true, nonClinicalResearch: true }, context)
    await f.app.get(ResearchAiWorker).tick()
    job = await service.get(job.id, context)
    expect(job).toMatchObject({
      status: 'FAILED',
      errorCode: 'GEMINI_TIMEOUT',
      canRetry: true,
      batchesCompleted: 1,
      result: null,
    })
    await f.api('post', `${root()}/retry`).set('X-Unit-Id', f.secondUnit).expect(404)
    job = responseBody<Case>(await f.api('post', `${root()}/retry`).expect(201))
    expect(job.status).toBe('QUEUED')
    expect(job.id).toBe(firstJobId)
    await f.api('post', `${root()}/retry`).expect(409)
    await f.app.get(ResearchAiWorker).tick()
    job = await service.get(job.id, context)
    expect(job.status).toBe('COMPLETED')
    expect(job.batchesCompleted).toBe(2)
    expect((job.result as { imagesReviewed: string[] }).imagesReviewed).toEqual(frameIds)
    const last = analyze.mock.calls.at(-1) as [Array<{ id: string }>]
    expect(last[0].map((i) => i.id)).toEqual(frameIds.slice(4))
    expect(analyze).toHaveBeenCalledTimes(callsBefore + 3)
    expect(ocr).toHaveBeenCalledTimes(ocrBefore)
    await expect(service.retry(job.id, context)).rejects.toThrow('Esta falha exige')
  })
  it('reanalyzes approved copies with an independent assessment and region for every image', async () => {
    const sourceId = job.id,
      [saved] = await f.database.query<Array<{ context: CompanyAccessContext }>>(
        'SELECT context FROM research_ai_cases WHERE id=$1',
        [sourceId],
      )
    const context = saved!.context,
      service = f.app.get(ResearchAiService),
      reanalysis = f.app.get(ResearchReanalysisService)
    await f.database.query(
      "UPDATE research_ai_cases SET prompt_version='visual-research-2' WHERE id=$1",
      [sourceId],
    )
    f.app.get(ConfigService).set('GEMINI_RESEARCH_IMAGES_PER_REQUEST', 1)
    const beforeCalls = analyze.mock.calls.length,
      beforeOcr = ocr.mock.calls.length,
      beforeUploads = f.storage.put.mock.calls.length
    job = await reanalysis.create(sourceId, context)
    expect(job).toMatchObject({
      status: 'QUEUED',
      sourceCaseId: sourceId,
      promptVersion: 'visual-research-3',
    })
    expect(job.frames.every((frame) => frame.reviewed)).toBe(true)
    expect((await reanalysis.create(sourceId, context)).id).toBe(job.id)
    await f.app.get(ResearchAiWorker).tick()
    job = await service.get(job.id, context)
    expect(job.status).toBe('COMPLETED')
    const result = job.result as {
      imageAssessments: Array<{ imageId: string; localizationStatus: string }>
      findings: Array<{ imageId: string }>
    }
    expect(result.imageAssessments).toHaveLength(6)
    expect(result.findings).toHaveLength(6)
    expect(new Set(result.findings.map((f) => f.imageId)).size).toBe(6)
    expect(
      analyze.mock.calls
        .slice(beforeCalls)
        .every((call: unknown[]) => Array.isArray(call[0]) && call[0].length === 1),
    ).toBe(true)
    expect(ocr).toHaveBeenCalledTimes(beforeOcr)
    expect(f.storage.put).toHaveBeenCalledTimes(beforeUploads)
    await f.database.query(
      'UPDATE research_ai_frames SET reviewed_revision=NULL WHERE case_id=$1 AND sequence=1',
      [sourceId],
    )
    await expect(reanalysis.create(sourceId, context)).rejects.toThrow('já conferidas')
    await f.database.query(
      'UPDATE research_ai_frames SET reviewed_revision=revision WHERE case_id=$1',
      [sourceId],
    )
    await instance()
    await expect(reanalysis.create(sourceId, context)).rejects.toThrow('O exame mudou')
  })
})
