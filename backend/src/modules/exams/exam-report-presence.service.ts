import { Injectable } from '@nestjs/common'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { WorkflowStoreService } from '../exam-workflow/workflow-store.service'
import { ReportSessionStore } from '../exam-workflow/report-session-store.service'
import { assertReportEditing } from './report-assignment.policy'
import { requireReportingDoctor } from './report-revision.policy'

@Injectable()
export class ExamReportPresenceService {
  constructor(private readonly workflow:WorkflowStoreService, private readonly sessions:ReportSessionStore){}
  async touch(examId:string,context:CompanyAccessContext,clientId:string) {
    return this.workflow.writable(examId,context,async(exam,manager)=>{
      assertReportEditing(exam,context)
      await requireReportingDoctor(exam.unitId,context,manager)
      return this.sessions.acquire(exam,context,clientId,manager)
    })
  }
}
