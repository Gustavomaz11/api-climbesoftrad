import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { createHash } from 'node:crypto'
import { ResearchAiService } from './research-ai.service'
import { ResearchImageStorage } from './research-image-storage.service'
import { GeminiResearchClient } from './gemini-research.client'
import {
  validateResearchResult,
  type ResearchCase,
  type ResearchResult,
} from './research-ai.contracts'
@Injectable()
export class ResearchAnalysisRunner {
  constructor(
    private readonly db: DataSource,
    private readonly research: ResearchAiService,
    private readonly storage: ResearchImageStorage,
    private readonly gemini: GeminiResearchClient,
  ) {}
  async run(job: ResearchCase) {
    if (!this.gemini.enabled) throw new Error('GEMINI_UNAVAILABLE')
    const frames = await this.research.frames(job.id)
    if (
      !frames.length ||
      frames.length !== job.frames_expected ||
      frames.some((f) => f.reviewed_revision !== f.revision)
    )
      throw new Error('COVERAGE_INCOMPLETE')
    const saved = await this.db.query<
      Array<{ number: number; image_ids: string[]; result: ResearchResult }>
    >('SELECT number,image_ids,result FROM research_ai_batches WHERE case_id=$1 ORDER BY number', [
      job.id,
    ])
    const covered = new Set<string>(),
      frameIds = frames.map((f) => f.id),
      results: ResearchResult[] = []
    for (const batch of saved) {
      if (batch.image_ids.some((id) => !frameIds.includes(id) || covered.has(id)))
        throw new Error('RESULT_INVALID')
      results.push(validateResearchResult(batch.result, batch.image_ids, true))
      batch.image_ids.forEach((id) => covered.add(id))
    }
    let batch: Array<{ id: string; png: Buffer }> = [],
      bytes = 0,
      number = saved.at(-1)?.number || 0
    const flush = async () => {
      if (!batch.length) return
      await this.research.validateLive(job)
      await this.db.query(
        "UPDATE research_ai_cases SET lease_until=now()+interval '5 minutes' WHERE id=$1",
        [job.id],
      )
      const result = await this.gemini.analyze(batch, job.model)
      await this.db.query(
        'INSERT INTO research_ai_batches(case_id,number,image_ids,result) VALUES($1,$2,$3,$4)',
        [job.id, ++number, batch.map((i) => i.id), JSON.stringify(result)],
      )
      results.push(result)
      await this.db.query(
        `UPDATE research_ai_cases SET batches_completed=$2,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=$1`,
        [job.id, number],
      )
      batch = []
      bytes = 0
    }
    for (const frame of frames) {
      const png = await this.storage.read(frame.redacted_key)
      if (createHash('sha256').update(png).digest('hex') !== frame.sha256)
        throw new Error('IMAGE_CHANGED')
      if (covered.has(frame.id)) continue
      if (png.length > 8 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE')
      if (batch.length >= this.gemini.imagesPerRequest || bytes + png.length > 8 * 1024 * 1024)
        await flush()
      batch.push({ id: frame.id, png })
      bytes += png.length
    }
    await flush()
    await this.research.validateLive(job)
    const result = validateResearchResult(
      {
        imageAssessments: results.flatMap((r) => r.imageAssessments || []),
        summary: results
          .map((r, i) => (results.length > 1 ? `Grupo ${i + 1}: ${r.summary}` : r.summary))
          .join('\n')
          .slice(0, 6000),
        limitations: [
          ...new Set([
            ...(results.length > 1
              ? [
                  this.gemini.imagesPerRequest === 1
                    ? 'Avaliação individual das imagens, sem correlação automática entre incidências.'
                    : 'Estudo processado em grupos, sem comparação visual global entre grupos.',
                ]
              : []),
            ...results.flatMap((r) => r.limitations),
          ]),
        ].slice(0, 30),
        imagesReviewed: results.flatMap((r) => r.imagesReviewed),
        findings: results.flatMap((r) => r.findings),
      },
      frames.map((f) => f.id),
      true,
    )
    await this.db.query(
      `UPDATE research_ai_cases SET status='COMPLETED',result=$2,batches_completed=$3,lease_until=NULL,updated_at=now() WHERE id=$1`,
      [job.id, JSON.stringify(result), number],
    )
  }
}
