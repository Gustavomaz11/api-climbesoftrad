import { Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { CompletedReportRow } from './report-completion.contracts'

@Injectable()
export class ReportVersionAccess {
  constructor(private readonly db:DataSource){}
  async require(id:string,context:CompanyAccessContext,manager:EntityManager=this.db.manager) {
    const [row]=await manager.query<CompletedReportRow[]>(`SELECT c.* FROM exam_report_completions c WHERE c.id=$1 AND (
      ($2::boolean AND c.company_id=$3 AND ($4::boolean OR c.unit_id=ANY($5::uuid[]))) OR
      ($6::boolean AND c.origin_company_id=$3 AND c.sent_at IS NOT NULL AND ($4::boolean OR c.origin_unit_id=ANY($5::uuid[]))))`,
      [id,context.permissions.includes('reports.view'),context.companyId,context.allUnits,context.unitIds,context.permissions.includes('hospital.results.view')])
    if(!row) throw new NotFoundException('Versão de laudo não encontrada.')
    return row
  }
}
