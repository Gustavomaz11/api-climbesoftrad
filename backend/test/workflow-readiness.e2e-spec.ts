import { createHash } from 'node:crypto'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import type { ExamEntity } from '../src/database/entities/exam.entity'
import { responseBody } from './operational-documents.fixture'
import { createWorkflowFixture } from './workflow.fixture'
import { syntheticDicom } from './synthetic-documents'

describe('Preparation evidence and interval integrity (e2e)', () => {
  let f: Awaited<ReturnType<typeof createWorkflowFixture>>
  beforeAll(async () => { f = await createWorkflowFixture() }, 30000)
  afterAll(async () => { await f?.app.close() })
  it('rechecks missing objects without preserving a stale ready state', async () => {
    const exam = await f.exam()
    await f.prepare(exam.id)
    const [file] = await f.database.query<Array<{ storage_key: string }>>('SELECT storage_key FROM stored_objects WHERE exam_id=$1', [exam.id])
    f.stored.delete(file!.storage_key)
    const changed = await f.current(exam.id)
    expect(changed.exam.workflowState).toBe('TO_PREPARE')
    expect(changed.exam.preparedAt).toBeNull()
    expect(changed.checklist.satisfied).toBe(false)
    await f.act(exam.id, 'start', 201)
    expect((await f.current(exam.id)).exam.workflowState).toBe('IN_PROGRESS')
  })
  it('keeps the reporting phase for multiple issues opened after devolution', async () => {
    const exam = await f.exam()
    await f.prepare(exam.id)
    await f.act(exam.id, 'start')
    for (const category of ['DOCUMENT','IMAGES']) await f.act(exam.id, 'issues', 201, { kind: 'PENDING', category })
    expect(await f.database.query<Array<{ phase: string }>>('SELECT phase FROM exam_workflow_issues WHERE exam_id=$1 ORDER BY opened_at', [exam.id])).toEqual([{ phase:'REPORTING' },{ phase:'REPORTING' }])
  })
  it('binds a reviewed documentary complement to the same patient and preserves both exams', async () => {
    const exam = await f.exam()
    const recall = responseBody<{ issue: { id: string } }>(await f.act(exam.id, 'issues', 201, { kind:'RECALL',category:'DOCUMENT',requestedAction:'DOCUMENTS' }))
    const original = (await f.current(exam.id)).exam
    const complement = await f.exam({ patientId: original.patientId, patientName: original.patientName })
    const attachment = await f.upload(complement.id)
    await f.act(exam.id, `issues/${recall.issue.id}/resolve`, 201, { complementExamId: complement.id, attachmentIds: [attachment.id] })
    const [record] = await f.database.query<Array<{ complement_exam_id: string }>>('SELECT complement_exam_id FROM exam_workflow_issues WHERE id=$1',[recall.issue.id])
    expect(record?.complement_exam_id).toBe(complement.id)
    const [count] = await f.database.query<Array<{ count: number }>>('SELECT COUNT(*)::int AS count FROM exams WHERE id=ANY($1::uuid[])',[[exam.id,complement.id]])
    expect(count?.count).toBe(2)
  })
  it('requires explicit image conference and invalidates preparation on a unique late instance', async () => {
    const studyUid='1.2.826.0.1.3680043.10.888.1'
    await f.api('post','/exam-catalog/aliases').send({examTypeId:f.type.id,unitId:f.unit,description:'TC teste',active:true}).expect(201)
    const ingest=async(instance:string)=>{
      const bytes=syntheticDicom({study:studyUid,instance,patient:'WORKFLOW_READY',name:'Paciente^Readiness'})
      const upload=responseBody<{id:string}>(await f.api('post','/uploads').send({kind:'DICOM',unitId:f.unit,name:'ready.dcm',contentType:'application/dicom',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}).expect(201))
      const session=await f.database.getRepository(UploadSessionEntity).findOneByOrFail({id:upload.id})
      f.pending.get(session.multipartId)!.parts.set(1,bytes)
      await f.api('post',`/uploads/${upload.id}/complete`).expect(201)
      await f.app.get(ImageIngestionWorker).runBatch()
      return responseBody<{examId:string}>(await f.api('get',`/uploads/${upload.id}`).expect(200)).examId
    }
    const id=await ingest('1.2.826.0.1.3680043.10.888.3')
    await f.api('post','/preparation-policies').send({unitId:f.unit,examTypeId:f.type.id,expectedVersion:0,requiredItems:['IMAGES'],reason:'Regra sintética de conferência de imagens'}).expect(201)
    await f.act(id,'check',409,{items:[{item:'IMAGES',confirmed:true}]})
    await f.api('post',`/exams/${id}/images/complete`).send({reason:'Recepção conferida'}).expect(201)
    await f.act(id,'release',409)
    await f.act(id,'check',201,{items:[{item:'IMAGES',confirmed:true}]})
    const released=responseBody<ExamEntity>(await f.act(id,'release'))
    expect(released.preparedAt).toBeTruthy()
    await ingest('1.2.826.0.1.3680043.10.888.3')
    expect((await f.current(id)).exam.workflowState).toBe('READY')
    await ingest('1.2.826.0.1.3680043.10.888.4')
    expect((await f.current(id)).exam.workflowState).toBe('TO_PREPARE')
    expect((await f.current(id)).exam.preparedAt).toBeNull()
  })
  it('preserves a valid cross-unit conference on read and invalidates it when the comparative changes', async () => {
    const prior = await f.exam({unitId:f.secondUnit,performedAt:'2026-10-13T12:00:00Z'})
    const patient=(await f.current(prior.id)).exam
    const exam=await f.exam({patientId:patient.patientId,patientName:patient.patientName})
    const document=await f.upload(prior.id)
    await f.api('post',`/exams/${exam.id}/comparatives`).send({comparativeExamId:prior.id}).expect(201)
    await f.api('post','/preparation-policies').send({unitId:f.unit,examTypeId:f.type.id,expectedVersion:1,requiredItems:['COMPARATIVE'],reason:'Comparação sintética conferida'}).expect(201)
    await f.act(exam.id,'check',201,{items:[{item:'COMPARATIVE',confirmed:true}]})
    await f.act(exam.id,'release')
    const technician=await f.technician()
    const viewed=responseBody<{exam:ExamEntity}>(await technician.api('get',`/exams/${exam.id}/workflow`).expect(200))
    expect(viewed.exam.workflowState).toBe('READY')
    await f.upload(prior.id,{replacesId:document.id,expectedVersion:'1',reason:'Comparativo corrigido'})
    expect((await f.current(exam.id)).exam.workflowState).toBe('TO_PREPARE')
    const next=(await f.current(exam.id)).exam
    await technician.api('post',`/exams/${exam.id}/workflow/check`).send({expectedVersion:next.workflowVersion,reason:'Comparativo de outra unidade',items:[{item:'COMPARATIVE',confirmed:true}]}).expect(409)
  })
})
