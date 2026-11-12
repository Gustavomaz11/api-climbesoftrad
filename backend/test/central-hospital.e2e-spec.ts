import { createHash } from 'node:crypto'
import { createOperationalDocumentsFixture,responseBody } from './operational-documents.fixture'
import { syntheticDicom } from './synthetic-documents'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'

describe('Hospitals are origin units of the SouRad central workspace',()=>{
  let f:Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  beforeAll(async()=>{f=await createOperationalDocumentsFixture()},30000)
  afterAll(async()=>{await f?.app.close()})
  it('opens the central workspace without selecting a company, even with legacy companies present',async()=>{
    await f.api('post','/companies').send({name:'Legacy hospital organization'}).expect(201)
    const me=responseBody<{centralCompanyId:string;activeCompany:{id:string}}>(await f.api('get','/auth/me').unset('X-Company-Id').expect(200))
    expect(me.centralCompanyId).toBe(initialCompanyId)
    expect(me.activeCompany.id).toBe(initialCompanyId)
  })
  it('publishes only after the hospital confirms, keeping its origin unit and original bytes',async()=>{
    const bytes=syntheticDicom({study:'1.2.826.0.1.3680043.10.800.1',series:'1.2.826.0.1.3680043.10.801.1',instance:'1.2.826.0.1.3680043.10.802.1'})
    const {id}=responseBody<{id:string}>(await f.api('post','/uploads').send({kind:'DICOM',unitId:f.unit,hospitalIntake:true,name:'central.dcm',contentType:'application/dicom',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}).expect(201))
    const source=await f.database.getRepository(UploadSessionEntity).findOneByOrFail({id})
    f.stored.set(source.storageKey,{body:bytes,metadata:{sha256:source.sha256}})
    await f.database.getRepository(UploadSessionEntity).update(id,{status:'RECEIVED'})
    await f.app.get(ImageIngestionWorker).runBatch()
    const [draft]=responseBody<Array<{id:string;version:number;fields:Record<string,unknown>}>>(await f.api('get','/hospital/intakes').expect(200))
    expect(responseBody<{total:number}>(await f.api('get','/exams').expect(200)).total).toBe(0)
    const sent=responseBody<{examId:string}>(await f.api('post',`/hospital/intakes/${draft!.id}/submit`).send({expectedVersion:draft!.version,fields:{...draft!.fields,performedAt:'2026-10-14T12:00:00Z',studyDescription:'TC hospital central',country:'Brasil',priority:'ROTINA'}}).expect(201))
    const queue=responseBody<{items:Array<{id:string;unitId:string}>}>(await f.api('get','/exams').expect(200))
    expect(queue.items).toEqual([expect.objectContaining({id:sent.examId,unitId:f.unit})])
    const published=await f.database.getRepository(UploadSessionEntity).findOneByOrFail({id})
    expect(published).toMatchObject({companyId:initialCompanyId,unitId:f.unit,status:'PUBLISHED',examId:sent.examId,storageKey:source.storageKey})
    expect(f.storage.copy).not.toHaveBeenCalled()
    await f.api('get',`/hospital/intakes/${draft!.id}`).set('X-Unit-Id',f.secondUnit).expect(404)
    const repeated=responseBody<{examId:string}>(await f.api('post',`/hospital/intakes/${draft!.id}/submit`).send({expectedVersion:draft!.version,fields:{...draft!.fields,performedAt:'2026-10-14T12:00:00Z',studyDescription:'TC hospital central',country:'Brasil',priority:'ROTINA'}}).expect(201))
    expect(repeated.examId).toBe(sent.examId)
  })
})
