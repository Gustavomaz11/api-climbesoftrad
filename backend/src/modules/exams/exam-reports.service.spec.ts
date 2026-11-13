import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common'
import type {DataSource,EntityManager} from 'typeorm'
import type {ExamEntity} from '../../database/entities/exam.entity'
import {companyTestContext as context} from '../../../test/company-test-context'
import {ExamReportsService,type ReportNode} from './exam-reports.service'
import type {R2ExamReportStorage} from './r2-exam-report-storage.service'
import type {ExamAccessService} from './exam-access.service'
import type {OperationalAuditService} from '../companies/operational-audit.service'
import type {CompanyPresentationService} from '../companies/company-presentation.service'
import type {WorkflowStoreService} from '../exam-workflow/workflow-store.service'
import type {ReportSessionStore} from '../exam-workflow/report-session-store.service'
import type {ReportDraftStore} from './report-draft-store.service'
import type {ReportDraft} from './report-lifecycle.contracts'

const exam={id:'7fb1e38b-685d-4cb2-9dc6-24ab39808267',companyId:context.companyId,unitId:context.unitIds[0],unit:{name:'Hospital A'},patientName:'Paciente sintético',studyDescription:'Exame de teste',performedAt:new Date(),modality:'MR',workflowState:'IN_PROGRESS',reportingUserId:context.userId} as ExamEntity
describe('Exam report draft and image access',()=>{
  const requireExam=jest.fn(),signedImageUrl=jest.fn(),uploadImage=jest.fn(),record=jest.fn(),assertOwner=jest.fn(),current=jest.fn()
  let completed=false,draft:ReportDraft
  const query=jest.fn((sql:string)=>Promise.resolve(sql.includes('SELECT p.registry_profile')?[{registry_profile:null,uf:null,active:true}]:completed?[{id:'signed'}]:[]))
  const manager={query} as unknown as EntityManager
  const getDraft=jest.fn(()=>Promise.resolve(draft))
  const saveDraft=jest.fn((_id:string,content:ReportNode)=>{draft={...draft,content,content_hash:'hash',has_content:true};return Promise.resolve(draft)})
  const service=new ExamReportsService(
    {signedImageUrl,uploadImage} as unknown as R2ExamReportStorage,
    {require:requireExam} as unknown as ExamAccessService,
    {record,external:(_context:unknown,_event:unknown,operation:()=>Promise<unknown>)=>operation()} as unknown as OperationalAuditService,
    {current:()=>Promise.resolve({effective:{headerText:'',footerText:'',signatureText:''}})} as unknown as CompanyPresentationService,
    {writable:async(id:string,ctx:unknown,operation:(exam:ExamEntity,manager:EntityManager)=>Promise<unknown>)=>operation(await requireExam(id,ctx) as ExamEntity,manager)} as WorkflowStoreService,
    {} as DataSource,
    {current,assertOwner} as unknown as ReportSessionStore,
    {get:getDraft,save:saveDraft} as unknown as ReportDraftStore,
  )
  beforeEach(()=>{
    jest.clearAllMocks();completed=false;requireExam.mockResolvedValue(exam);current.mockResolvedValue(null);assertOwner.mockResolvedValue({})
    draft={exam_id:exam.id,content:{type:'doc',content:[{type:'paragraph'}]},content_hash:'hash',has_content:false,updated_at:new Date(),updated_by_user_id:context.userId,base_completion_id:null,revision_reason:null}
  })
  it('returns an empty document before the first save',async()=>{
    await expect(service.get(exam.id,context)).resolves.toMatchObject({content:draft.content,updatedAt:null})
  })
  it('hydrates only image links belonging to this exam and records saves',async()=>{
    const key='reports/'+exam.id+'/images/image.png'
    const content={type:'doc',content:[{type:'image',attrs:{storageKey:key,src:'expired'}}]}
    await service.save(exam.id,{clientId:'client',content},context)
    signedImageUrl.mockResolvedValue('https://signed.example/image.png')
    const reopened=await service.get(exam.id,context)
    expect(reopened.content.content?.[0]?.attrs?.src).toBe('https://signed.example/image.png')
    expect(record).toHaveBeenCalledWith(context,expect.objectContaining({action:'REPORT_SAVED'}),manager)
  })
  it('does not write a draft or image after the editing session ends',async()=>{
    assertOwner.mockRejectedValueOnce(new ConflictException())
    await expect(service.save(exam.id,{clientId:'old',content:{type:'doc'}},context)).rejects.toBeInstanceOf(ConflictException)
    expect(saveDraft).not.toHaveBeenCalled()
  })
  it('rejects unsupported images and finalized drafts',async()=>{
    await expect(service.uploadImage(exam.id,{mimetype:'application/pdf'} as Express.Multer.File,context,'client')).rejects.toBeInstanceOf(BadRequestException)
    completed=true
    await expect(service.save(exam.id,{clientId:'client',content:{type:'doc'}},context)).rejects.toBeInstanceOf(ConflictException)
    await expect(service.uploadImage(exam.id,{} as Express.Multer.File,context,'client')).rejects.toBeInstanceOf(ConflictException)
    expect(uploadImage).not.toHaveBeenCalled()
  })
  it('does not load content or sign URLs for inaccessible or occupied exams',async()=>{
    requireExam.mockRejectedValueOnce(new NotFoundException())
    await expect(service.get(exam.id,context)).rejects.toBeInstanceOf(NotFoundException)
    current.mockResolvedValueOnce({user_id:'another-doctor'})
    await expect(service.get(exam.id,context)).rejects.toBeInstanceOf(ConflictException)
    expect(getDraft).not.toHaveBeenCalled();expect(signedImageUrl).not.toHaveBeenCalled()
  })
})
