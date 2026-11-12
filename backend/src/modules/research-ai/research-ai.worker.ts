import { ResearchAnalysisRunner } from './research-analysis-runner.service'
import { retryableResearchErrors } from './gemini-errors'
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { ResearchAiService } from './research-ai.service'
import { ResearchFramePreparer } from './research-frame-preparer.service'
import {
  type ResearchCase,
  anonymizationVersion,
  researchPromptVersion,
} from './research-ai.contracts'

const publicErrors = new Set([
  ...retryableResearchErrors,
  'GEMINI_ACCESS_DENIED',
  'GEMINI_REQUEST_REJECTED',
  'SOURCE_CHANGED',
  'ANONYMIZATION_UPDATED',
  'ARCHIVE_PENDING',
  'FRAME_MANIFEST_INVALID',
  'FRAME_LIMIT_EXCEEDED',
  'NO_IMAGES',
  'LOCAL_OCR_FAILED',
  'IMAGE_TOO_LARGE',
  'IMAGE_CHANGED',
  'GEMINI_UNAVAILABLE',
  'GEMINI_QUOTA_EXCEEDED',
  'RESULT_INVALID',
  'RESULT_INCOMPLETE',
  'COVERAGE_INCOMPLETE',
])
@Injectable()
export class ResearchAiWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  private busy = false
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly research: ResearchAiService,
    private readonly preparer: ResearchFramePreparer,
    private readonly runner: ResearchAnalysisRunner,
  ) {}
  onModuleInit() {
    if (this.config.get('NODE_ENV') !== 'test')
      this.timer = setInterval(() => void this.tick().catch(() => {}), 2000)
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }
  async tick() {
    if (this.busy) return
    this.busy = true
    try {
      await this.db
        .query(`UPDATE research_ai_cases SET status='FAILED',error_code='PROCESS_INTERRUPTED',lease_until=NULL,updated_at=now()
        WHERE status IN ('PREPARING','RUNNING') AND lease_until<now()`)
      const job = await this.db.transaction(async (manager) => {
        const [row]: ResearchCase[] = await manager.query(
          `SELECT * FROM research_ai_cases WHERE (status='PREPARING' AND lease_until IS NULL) OR status='QUEUED' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
        if (row)
          await manager.query(
            `UPDATE research_ai_cases SET status=CASE WHEN status='QUEUED' THEN 'RUNNING' ELSE status END,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=$1`,
            [row.id],
          )
        return row
      })
      if (!job) return
      try {
        if (
          job.anonymization_version !== anonymizationVersion ||
          job.prompt_version !== researchPromptVersion
        )
          throw new Error('ANONYMIZATION_UPDATED')
        await this.research.validateLive(job)
        if (job.status === 'PREPARING') {
          await this.preparer.prepare(job)
          await this.research.validateLive(job)
          await this.db.query(
            `UPDATE research_ai_cases SET status='REVIEW',lease_until=NULL,updated_at=now() WHERE id=$1 AND status='PREPARING'`,
            [job.id],
          )
        } else await this.runner.run(job)
      } catch (error) {
        const code =
          error instanceof Error && publicErrors.has(error.message)
            ? error.message
            : 'RESEARCH_FAILED'
        await this.db.query(
          `UPDATE research_ai_cases SET status=$2,error_code=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND status IN ('PREPARING','RUNNING')`,
          [
            job.id,
            ['SOURCE_CHANGED', 'ANONYMIZATION_UPDATED'].includes(code) ? 'STALE' : 'FAILED',
            code,
          ],
        )
      }
    } finally {
      this.busy = false
    }
  }
}
