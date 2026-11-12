import { StoredObjectEntity } from '../src/database/entities/stored-object.entity'
import { ExamAttachments1840000000000 } from '../src/database/migrations/1840000000000-ExamAttachments'
import { OperationalAuditService } from '../src/modules/companies/operational-audit.service'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticPdf } from './synthetic-documents'
import { ExamAttachmentEntity } from '../src/database/entities/exam-attachment.entity'

describe('Classified exam documents, versions and patient history (e2e)', () => {
  let fixture: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let exam: { id: string; patientId: string }
  let pdf:Buffer
  const upload = (examId: string, category = 'ORDER') =>
    fixture
      .api('post', `/exams/${examId}/attachments`)
      .field('category', category)
      .attach('file', pdf, { filename: 'pedido.pdf', contentType: 'application/pdf' })
  beforeAll(async () => {
    pdf=await syntheticPdf()
    fixture = await createOperationalDocumentsFixture()
    exam = await fixture.exam()
  }, 30000)
  afterAll(async () => {
    await fixture?.app.close()
  })
  it('stores the exact hash, metadata and category without publishing permanent links', async () => {
    const created = responseBody<{ id: string }>(await upload(exam.id).expect(201))
    const listed = responseBody<Array<{ id: string; sha256: string; url?: string }>>(
      await fixture.api('get', `/exams/${exam.id}/attachments`).expect(200),
    )
    expect(listed).toEqual([
      expect.objectContaining({
        id: created.id,
        category: 'ORDER',
        version: 1,
        current: true,
        sizeBytes: pdf.length,
        validationStatus: 'APPROVED',
      }),
    ])
    expect(listed[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(listed[0]?.url).toBeUndefined()
    const access = responseBody<{ url: string }>(
      await fixture.api('get', `/exams/${exam.id}/attachments/${created.id}/access`).expect(200),
    )
    expect(access.url).toContain('https://storage.example.test/')
    expect(fixture.storage.signedGetUrl).toHaveBeenLastCalledWith(expect.any(String), 300)
    expect(
      await fixture.database.query<Array<{ count: number }>>(
        "SELECT COUNT(*)::int AS count FROM operational_events WHERE action='EXAM_ATTACHMENT_ACCESSED' AND resource_id=$1",
        [exam.id],
      ),
    ).toEqual([{ count: 1 }])
  })
  it('rejects missing, empty, disguised and unsupported files before uploading', async () => {
    const previousCalls = fixture.storage.put.mock.calls.length
    await fixture
      .api('post', `/exams/${exam.id}/attachments`)
      .field('category', 'ORDER')
      .expect(400)
    for (const [content, type] of [
      [Buffer.alloc(0), 'application/pdf'],
      [Buffer.from('invalid pdf'), 'application/pdf'],
      [Buffer.from('text'), 'text/plain'],
    ] as const)
      await fixture
        .api('post', `/exams/${exam.id}/attachments`)
        .field('category', 'ORDER')
        .attach('file', content, { filename: 'invalid.pdf', contentType: type })
        .expect(400)
    await upload(exam.id, 'UNSUPPORTED').expect(400)
    expect(fixture.storage.put.mock.calls).toHaveLength(previousCalls)
  })
  it('allows one concurrent replacement, preserves the original bytes and records the reason', async () => {
    const original = responseBody<{ id: string }>(
      await upload(exam.id, 'QUESTIONNAIRE').expect(201),
    )
    const replacement = () =>
      upload(exam.id, 'QUESTIONNAIRE')
        .field('replacesId', original.id)
        .field('expectedVersion', '1')
        .field('reason', 'Questionário corrigido')
    const responses = await Promise.all([replacement(), replacement()])
    expect(responses.map((result) => result.status).sort()).toEqual([201, 409])
    const records = responseBody<Array<{ id: string; version: number; current: boolean }>>(
      await fixture.api('get', `/exams/${exam.id}/attachments`).expect(200),
    )
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.id, current: false, version: 1 }),
        expect.objectContaining({
          replacesId: original.id,
          current: true,
          version: 2,
          reason: 'Questionário corrigido',
        }),
      ]),
    )
    await fixture.api('get', `/exams/${exam.id}/attachments/${original.id}/access`).expect(200)
    await replacement().expect(409)
  })
  it('requires the expected version, original category and a reason on replacement', async () => {
    const original = responseBody<{ id: string }>(await upload(exam.id).expect(201))
    await upload(exam.id).field('replacesId', original.id).expect(400)
    await upload(exam.id, 'COMPARATIVE')
      .field('replacesId', original.id)
      .field('expectedVersion', '1')
      .field('reason', 'Troca')
      .expect(400)
  })
  it('isolates attachments and URLs by exam, company and selected unit', async () => {
    const original = responseBody<{ id: string }>(await upload(exam.id).expect(201))
    const another = await fixture.exam()
    await fixture.api('get', `/exams/${another.id}/attachments/${original.id}/access`).expect(404)
    await fixture
      .api('get', `/exams/${exam.id}/attachments`)
      .set('X-Unit-Id', fixture.secondUnit)
      .expect(404)
    await upload(exam.id).set('X-Unit-Id', fixture.secondUnit).expect(404)
    const company = responseBody<{ id: string }>(
      await fixture
        .api('post', '/companies')
        .send({ name: 'Empresa Documentos Externos' })
        .expect(201),
    )
    await fixture
      .api('get', `/exams/${exam.id}/attachments/${original.id}/access`, company.id)
      .expect(404)
  })
  it('shows real attachment availability in the history and rejects missing or altered storage objects', async () => {
    const availability = () =>
      fixture.api('get', `/patients/${exam.patientId}/history/${exam.id}/availability`)
    expect(
      responseBody<{ attachments: string }>(await availability().expect(200)).attachments,
    ).toBe('AVAILABLE')
    const original = responseBody<{ id: string }>(await upload(exam.id).expect(201))
    const [object] = await fixture.database.query<Array<{ storageKey: string }>>(
      'SELECT o.storage_key AS "storageKey" FROM stored_objects o JOIN exam_attachments a ON a.object_id=o.id WHERE a.id=$1',
      [original.id],
    )
    fixture.stored.delete(object!.storageKey)
    await fixture.api('get', `/exams/${exam.id}/attachments/${original.id}/access`).expect(404)
    expect(
      responseBody<{ attachments: string }>(await availability().expect(200)).attachments,
    ).toBe('RECOVERY_REQUIRED')
    fixture.stored.set(object!.storageKey, { body: pdf, metadata: { sha256: 'different' } })
    await fixture.api('get', `/exams/${exam.id}/attachments/${original.id}/access`).expect(409)
  })
  it('preserves an unreferenced inventory record when database publication fails', async () => {
    const target = await fixture.exam()
    const audit = fixture.app.get(OperationalAuditService)
    const fail = jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('Audit unavailable'))
    await upload(target.id).expect(500)
    fail.mockRestore()
    expect(
      responseBody<unknown[]>(
        await fixture.api('get', `/exams/${target.id}/attachments`).expect(200),
      ),
    ).toEqual([])
    const objects = await fixture.database
      .getRepository(StoredObjectEntity)
      .findBy({ examId: target.id })
    expect(objects).toHaveLength(1)
    expect(objects[0]?.status).toBe('UNREFERENCED')
    expect(fixture.stored.has(objects[0]!.storageKey)).toBe(true)
  })
  it('blocks schema rollback after any classified file has been registered', async () => {
    const runner = fixture.database.createQueryRunner()
    await runner.connect()
    try {
      await expect(new ExamAttachments1840000000000().down(runner)).rejects.toThrow(
        'Anexos preservados',
      )
    } finally {
      await runner.release()
    }
  })
  it('holds legacy signature-only files until authorized structural and malware revalidation',async()=>{
    const target=await fixture.exam(),created=responseBody<{id:string}>(await upload(target.id).expect(201))
    await fixture.database.getRepository(ExamAttachmentEntity).update(created.id,{validationStatus:'SIGNATURE_VALIDATED'})
    await fixture.api('get',`/exams/${target.id}/attachments/${created.id}/access`).expect(409)
    await fixture.api('post',`/exams/${target.id}/attachments/${created.id}/reprocess`).expect(201)
    await fixture.api('get',`/exams/${target.id}/attachments/${created.id}/access`).expect(200)
    const saved=await fixture.database.getRepository(ExamAttachmentEntity).findOneByOrFail({id:created.id})
    expect(saved.version).toBe(1);expect(saved.validationStatus).toBe('APPROVED')
  })
})
