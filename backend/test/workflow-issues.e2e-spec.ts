import { randomUUID } from 'node:crypto'
import type { ExamEntity } from '../src/database/entities/exam.entity'
import type { WorkflowIssue } from '../src/modules/exam-workflow/workflow.contracts'
import { WorkflowStoreService } from '../src/modules/exam-workflow/workflow-store.service'
import { companyTestContext } from './company-test-context'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { responseBody } from './operational-documents.fixture'
import { createWorkflowFixture } from './workflow.fixture'
import { createHash } from 'node:crypto'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import { syntheticDicom } from './synthetic-documents'

describe('Pending issues, recalls and cancellation (e2e)', () => {
  let f: Awaited<ReturnType<typeof createWorkflowFixture>>
  beforeAll(async () => { f = await createWorkflowFixture() }, 30000)
  afterAll(async () => { await f?.app.close() })
  const open = async (id: string, values: Record<string, unknown> = {}) => responseBody<{ exam: ExamEntity; issue: WorkflowIssue }>(await f.act(id, 'issues', 201, { kind: 'PENDING', category: 'DOCUMENT', ...values }))
  it('tracks multiple reasons, responsibilities, notices and resolution intervals', async () => {
    const technician = await f.technician(), exam = await f.exam()
    const first = await open(exam.id, { responsibleUserId: technician.user.id }), second = await open(exam.id, { category: 'IMAGES' })
    expect((await f.current(exam.id)).exam.workflowState).toBe('PENDING')
    const notices = responseBody<Array<{ id: string; phase: string; seen_at: string | null }>>(await technician.api('get', '/workflow-notifications').expect(200))
    expect(notices).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.issue.id, phase: 'PREPARATION', seen_at: null })]))
    await technician.api('post', `/workflow-notifications/${first.issue.id}/acknowledge`).expect(201)
    await technician.api('post', `/workflow-notifications/${first.issue.id}/acknowledge`).expect(201)
    await f.act(exam.id, `issues/${first.issue.id}/resolve`)
    expect((await f.current(exam.id)).exam.workflowState).toBe('PENDING')
    await f.act(exam.id, `issues/${first.issue.id}/resolve`, 409)
    await f.upload(exam.id)
    await f.act(exam.id, `issues/${second.issue.id}/resolve`)
    const snapshot = await f.current(exam.id)
    expect(snapshot.exam.workflowState).toBe('TO_PREPARE')
    expect(snapshot.exam.preparedAt).toBeNull()
    expect(snapshot.issues.every(issue => issue.resolved_at)).toBe(true)
    const [interval] = await f.database.query<Array<{ elapsed: number }>>('SELECT EXTRACT(EPOCH FROM (resolved_at-opened_at))::float AS elapsed FROM exam_workflow_issues WHERE id=$1', [first.issue.id])
    expect(interval!.elapsed).toBeGreaterThanOrEqual(0)
    expect(await f.database.query<Array<{ count: number }>>("SELECT COUNT(*)::int AS count FROM operational_events WHERE action='EXAM_ISSUE_ACKNOWLEDGED' AND resource_id=$1", [first.issue.id])).toEqual([{ count: 1 }])
  })
  it('requires a new approved document to resolve documentary recall and rejects cross-patient evidence', async () => {
    const exam = await f.exam(), other = await f.exam(), old = await f.upload(exam.id), foreign = await f.upload(other.id)
    const recall = await open(exam.id, { kind: 'RECALL', requestedAction: 'DOCUMENTS' })
    await f.act(exam.id, `issues/${recall.issue.id}/resolve`, 400, { attachmentIds: [old.id] })
    await f.act(exam.id, `issues/${recall.issue.id}/resolve`, 400, { attachmentIds: [foreign.id] })
    await f.act(exam.id, `issues/${recall.issue.id}/resolve`, 400, { complementExamId: other.id, attachmentIds: [foreign.id] })
    const added = await f.upload(exam.id)
    await f.act(exam.id, `issues/${recall.issue.id}/resolve`, 201, { attachmentIds: [added.id] })
    expect((await f.current(exam.id)).exam.workflowState).toBe('TO_PREPARE')
    expect(await f.database.query<Array<{ resolution_attachment_ids: string[] }>>('SELECT resolution_attachment_ids FROM exam_workflow_issues WHERE id=$1', [recall.issue.id])).toEqual([{ resolution_attachment_ids: [added.id] }])
  })
  it('preserves the chart, blocks clinical writes and removes cancelled/archived records from active queues', async () => {
    const exam = await f.exam(), archived = await f.exam(), document = await f.upload(exam.id)
    const content = { type: 'doc', content: [{ type: 'paragraph' }] }
    await f.api('put', `/exams/${exam.id}/report`).send({ content }).expect(200)
    await f.api('put', `/exams/${exam.id}/report/presence/${randomUUID()}`).expect(200)
    await f.act(exam.id, 'cancel')
    await f.api('put', `/exams/${exam.id}/report`).send({ content }).expect(409)
    await f.api('put', `/exams/${exam.id}/prescription`).send({ content }).expect(409)
    await f.api('put', `/exams/${exam.id}/prescription/sign`).send({ content }).expect(409)
    await f.api('put', `/exams/${exam.id}/report/presence/${randomUUID()}`).expect(409)
    await f.api('post', `/exams/${exam.id}/attachments`).field('category','ORDER').attach('file', Buffer.from('bad'), { filename:'bad.pdf',contentType:'application/pdf' }).expect(409)
    await f.api('get', `/exams/${exam.id}/report`).expect(200)
    expect(responseBody<Array<{ id: string }>>(await f.api('get', `/exams/${exam.id}/attachments`).expect(200))).toEqual(expect.arrayContaining([expect.objectContaining({ id: document.id })]))
    expect(await f.database.query<unknown[]>('SELECT * FROM exam_report_presences WHERE exam_id=$1', [exam.id])).toEqual([])
    await f.act(archived.id, 'archive')
    const active = responseBody<{ items: Array<{ id: string }> }>(await f.api('get','/exams?queue=ACTIVE&pageSize=50').expect(200))
    expect(active.items.map(item => item.id)).not.toContain(exam.id)
    expect(active.items.map(item => item.id)).not.toContain(archived.id)
    const history = responseBody<{ items: Array<{ id: string }> }>(await f.api('get','/exams?queue=HISTORY&pageSize=50').expect(200))
    expect(history.items.map(item => item.id)).toEqual(expect.arrayContaining([exam.id,archived.id]))
    await f.act(archived.id, 'unarchive')
    expect((await f.current(archived.id)).exam.archivedAt).toBeNull()
    await f.act(exam.id, 'release', 409)
  })
  it('serializes cancellation with an already authorized clinical write', async () => {
    const exam = await f.exam()
    const [admin] = await f.database.query<Array<{ id: string }>>("SELECT id FROM auth_users WHERE role='ADMIN' LIMIT 1")
    const context = { ...companyTestContext, userId: admin!.id, companyId: initialCompanyId, allUnits: true }
    let entered!: () => void, finish!: () => void
    const started = new Promise<void>(resolve => { entered = resolve }), barrier = new Promise<void>(resolve => { finish = resolve })
    const write = f.app.get(WorkflowStoreService).writable(exam.id, context, async () => { entered(); await barrier; return 'written' })
    await started
    const cancel = f.api('post', `/exams/${exam.id}/workflow/cancel`).send({ expectedVersion: 1, reason: 'Cancelamento serializado' }).then(result => result)
    finish()
    expect(await write).toBe('written')
    expect((await cancel).status).toBe(201)
    await expect(f.app.get(WorkflowStoreService).writable(exam.id, context, () => Promise.resolve('forbidden'))).rejects.toThrow('cancelado')
  })
  it('accepts unique late DICOM instances for recall and rejects an idempotent resend as new acquisition', async () => {
    const studyUid = '1.2.826.0.1.3680043.10.999.1'
    const ingest = async (instance: string) => {
      const bytes = syntheticDicom({ study: studyUid, instance, patient: 'WORKFLOW_DICOM', name: 'Paciente^Workflow^Dicom' })
      const session = responseBody<{ id: string }>(await f.api('post','/uploads').send({ kind:'DICOM',unitId:f.unit,name:'workflow.dcm',contentType:'application/dicom',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex') }).expect(201))
      const stored = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id:session.id })
      f.pending.get(stored.multipartId)!.parts.set(1, bytes)
      await f.api('post',`/uploads/${session.id}/complete`).expect(201)
      await f.app.get(ImageIngestionWorker).runBatch()
      return responseBody<{ examId: string; resultId: string }>(await f.api('get',`/uploads/${session.id}`).expect(200))
    }
    const initial = await ingest('1.2.826.0.1.3680043.10.999.3')
    const recall = await open(initial.examId, { kind:'RECALL',category:'IMAGES',requestedAction:'ACQUISITION' })
    await f.api('post',`/exams/${initial.examId}/images/complete`).send({reason:'Recepção sintética conferida'}).expect(201)
    const [study] = await f.database.query<Array<{ id: string }>>('SELECT id FROM dicom_studies WHERE exam_id=$1',[initial.examId])
    await ingest('1.2.826.0.1.3680043.10.999.3')
    await f.act(initial.examId,`issues/${recall.issue.id}/resolve`,400,{studyIds:[study!.id],acquisitionConfirmed:true})
    const added = await ingest('1.2.826.0.1.3680043.10.999.4')
    expect(added.examId).toBe(initial.examId)
    await f.act(initial.examId,`issues/${recall.issue.id}/resolve`,400,{studyIds:[study!.id],acquisitionConfirmed:true})
    await f.api('post',`/exams/${initial.examId}/images/complete`).send({reason:'Nova aquisição conferida manualmente'}).expect(201)
    await f.act(initial.examId,`issues/${recall.issue.id}/resolve`,400,{studyIds:[study!.id]})
    await f.act(initial.examId,`issues/${recall.issue.id}/resolve`,201,{studyIds:[study!.id],acquisitionConfirmed:true})
    expect(await f.database.query<Array<{ count: number }>>('SELECT COUNT(*)::int AS count FROM dicom_instances WHERE study_id=$1',[study!.id])).toEqual([{ count:2 }])
  })
})
