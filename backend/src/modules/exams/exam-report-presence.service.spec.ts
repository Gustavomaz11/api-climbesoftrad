import {ForbiddenException,NotFoundException} from '@nestjs/common'
import type {EntityManager} from 'typeorm'
import type {ExamEntity} from '../../database/entities/exam.entity'
import type {WorkflowStoreService} from '../exam-workflow/workflow-store.service'
import type {ReportSessionStore} from '../exam-workflow/report-session-store.service'
import {companyTestContext as context} from '../../../test/company-test-context'
import {ExamReportPresenceService} from './exam-report-presence.service'

describe('Medical report editing session authorization',()=>{
  const acquire=jest.fn(),requireExam=jest.fn()
  const manager={query:()=>Promise.resolve([{active:true,uf:null,registry_profile:null}])} as unknown as EntityManager
  const service=new ExamReportPresenceService(
    {writable:async(id:string,ctx:unknown,operation:(exam:ExamEntity,manager:EntityManager)=>Promise<unknown>)=>operation(await requireExam(id,ctx) as ExamEntity,manager)} as WorkflowStoreService,
    {acquire} as unknown as ReportSessionStore,
  )
  beforeEach(()=>{jest.clearAllMocks();requireExam.mockResolvedValue({id:'exam',unitId:context.unitIds[0],workflowState:'IN_PROGRESS',reportingUserId:context.userId});acquire.mockResolvedValue({active:true,releaseRequested:false})})
  it('does not acquire an inaccessible examination',async()=>{
    requireExam.mockRejectedValueOnce(new NotFoundException())
    await expect(service.touch('exam',context,'client')).rejects.toBeInstanceOf(NotFoundException)
    expect(acquire).not.toHaveBeenCalled()
  })
  it('does not grant a nonmedical administrator an editing session',async()=>{
    await expect(service.touch('exam',{...context,role:'ADMIN'},'client')).rejects.toBeInstanceOf(ForbiddenException)
    expect(acquire).not.toHaveBeenCalled()
  })
  it('only acquires the assigned physician session',async()=>{
    requireExam.mockResolvedValueOnce({workflowState:'IN_PROGRESS',reportingUserId:'other-doctor'})
    await expect(service.touch('exam',context,'client')).rejects.toBeInstanceOf(ForbiddenException)
    expect(acquire).not.toHaveBeenCalled()
    await expect(service.touch('exam',context,'client')).resolves.toMatchObject({active:true})
  })
})
