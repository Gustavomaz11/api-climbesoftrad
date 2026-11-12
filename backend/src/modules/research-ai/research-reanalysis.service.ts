import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { ResearchAiService } from './research-ai.service'
import { GeminiResearchClient } from './gemini-research.client'
import { anonymizationVersion, researchPromptVersion } from './research-ai.contracts'

@Injectable()
export class ResearchReanalysisService {
  constructor(
    private readonly db: DataSource,
    private readonly research: ResearchAiService,
    private readonly gemini: GeminiResearchClient,
  ) {}
  async create(sourceId: string, context: CompanyAccessContext) {
    const source = await this.research.require(sourceId, context),
      frames = await this.research.frames(sourceId)
    if (!this.gemini.enabled) throw new ServiceUnavailableException('Pesquisa desabilitada.')
    if (
      !['COMPLETED', 'FAILED'].includes(source.status) ||
      source.anonymization_version !== anonymizationVersion ||
      !frames.length ||
      frames.length !== source.frames_expected ||
      frames.some((f) => f.reviewed_revision !== f.revision)
    )
      throw new ConflictException(
        'A reanálise exige cópias anonimizadas já conferidas de uma pesquisa finalizada.',
      )
    try {
      await this.research.validateLive({ ...source, context })
    } catch (error) {
      if (error instanceof Error && error.message === 'SOURCE_CHANGED')
        throw new ConflictException(
          'O exame mudou. Prepare e confira novas cópias de todas as imagens.',
        )
      throw error
    }
    const id = await this.db.transaction(async (manager) => {
      await manager.query(
        `UPDATE research_ai_cases SET status='STALE',error_code='ANONYMIZATION_UPDATED',updated_at=now()
        WHERE exam_id=$1 AND created_by_user_id=$2 AND status IN ('PREPARING','REVIEW') AND (prompt_version<>$3 OR anonymization_version<>$4)`,
        [source.exam_id, context.userId, researchPromptVersion, anonymizationVersion],
      )
      const candidate = randomUUID()
      const [row] = await manager.query<
        Array<{ id: string; prompt_version: string; anonymization_version: string }>
      >(
        `INSERT INTO research_ai_cases(id,company_id,unit_id,exam_id,created_by_user_id,context,source_hash,source_snapshot,status,model,prompt_version,anonymization_version,frames_expected,frames_prepared,source_case_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'QUEUED',$9,$10,$11,$12,$12,$13)
        ON CONFLICT (exam_id,created_by_user_id) WHERE status IN ('PREPARING','REVIEW','QUEUED','RUNNING') DO UPDATE SET updated_at=research_ai_cases.updated_at RETURNING id,prompt_version,anonymization_version`,
        [
          candidate,
          source.company_id,
          source.unit_id,
          source.exam_id,
          context.userId,
          JSON.stringify(context),
          source.source_hash,
          JSON.stringify(source.source_snapshot),
          this.gemini.model,
          researchPromptVersion,
          anonymizationVersion,
          frames.length,
          sourceId,
        ],
      )
      if (
        !row ||
        row.prompt_version !== researchPromptVersion ||
        row.anonymization_version !== anonymizationVersion
      )
        throw new ConflictException('Aguarde a análise em andamento antes de reanalisar.')
      if (row.id === candidate)
        for (const frame of frames)
          await manager.query(
            `INSERT INTO research_ai_frames(id,case_id,instance_id,frame_index,sequence,width,height,base_key,redacted_key,masks,automatic_masks,revision,reviewed_revision,sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13)`,
            [
              randomUUID(),
              candidate,
              frame.instance_id,
              frame.frame_index,
              frame.sequence,
              frame.width,
              frame.height,
              frame.base_key,
              frame.redacted_key,
              JSON.stringify(frame.masks),
              JSON.stringify(frame.automatic_masks),
              frame.revision,
              frame.sha256,
            ],
          )
      return row.id
    })
    return this.research.get(id, context)
  }
}
