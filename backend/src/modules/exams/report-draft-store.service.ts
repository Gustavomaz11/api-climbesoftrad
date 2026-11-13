import { Injectable, PayloadTooLargeException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { DataSource, type EntityManager } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { ReportNode } from './exam-reports.service'
import { hasReportContent, type ReportDraft } from './report-lifecycle.contracts'
import { R2ExamReportStorage } from './r2-exam-report-storage.service'

export const reportContentHash = (content: ReportNode) => createHash('sha256').update(JSON.stringify(content)).digest('hex')

@Injectable()
export class ReportDraftStore {
  constructor(private readonly db: DataSource, private readonly storage: R2ExamReportStorage) {}
  async get(id: string, context: CompanyAccessContext, manager: EntityManager = this.db.manager): Promise<ReportDraft> {
    const [existing] = await manager.query<ReportDraft[]>('SELECT * FROM exam_report_drafts WHERE exam_id=$1', [id])
    if (existing) return existing
    const old = await this.storage.read(id)
    const legacy = old ? JSON.parse(old) as {content:ReportNode;updatedAt:string;updatedByUserId:string} : null
    const content = legacy?.content ?? {type:'doc',content:[{type:'paragraph'}]}
    await manager.query(`INSERT INTO exam_report_drafts(exam_id,content,content_hash,has_content,updated_by_user_id,updated_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(exam_id) DO NOTHING`, [id,JSON.stringify(content),reportContentHash(content),hasReportContent(content),legacy?.updatedByUserId??context.userId,legacy?.updatedAt??new Date()])
    return (await manager.query<ReportDraft[]>('SELECT * FROM exam_report_drafts WHERE exam_id=$1',[id]))[0]!
  }
  async save(id: string, content: ReportNode, userId: string, manager: EntityManager) {
    const hasContent=hasReportContent(content)
    const serialized = JSON.stringify(content)
    if (Buffer.byteLength(serialized,'utf8')>2_000_000) throw new PayloadTooLargeException('Laudo excede o limite permitido.')
    const [saved] = await manager.query<ReportDraft[]>(`INSERT INTO exam_report_drafts(exam_id,content,content_hash,has_content,updated_by_user_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(exam_id) DO UPDATE SET content=EXCLUDED.content,content_hash=EXCLUDED.content_hash,
      has_content=EXCLUDED.has_content,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now() RETURNING *`,
      [id,serialized,reportContentHash(content),hasContent,userId])
    return saved!
  }
}
