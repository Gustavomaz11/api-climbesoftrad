import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { ResearchAiService } from './research-ai.service'
import { ResearchImageStorage, redactResearchPng } from './research-image-storage.service'
import type { ResearchCase, ResearchFrame } from './research-ai.contracts'
import type {
  SaveResearchMasksDto as SaveMasksDto,
  ReviewResearchFrameDto as ReviewFrameDto,
} from './research-ai.dto'
@Injectable()
export class ResearchFrameReviewService {
  constructor(
    private readonly db: DataSource,
    private readonly research: ResearchAiService,
    private readonly storage: ResearchImageStorage,
  ) {}
  async image(id: string, frameId: string, original: boolean, context: CompanyAccessContext) {
    await this.research.require(id, context)
    const [frame]: ResearchFrame[] = await this.db.query(
      'SELECT * FROM research_ai_frames WHERE case_id=$1 AND id=$2',
      [id, frameId],
    )
    if (!frame) throw new NotFoundException()
    return this.storage.read(original ? frame.base_key : frame.redacted_key)
  }
  async masks(id: string, frameId: string, dto: SaveMasksDto, context: CompanyAccessContext) {
    await this.research.require(id, context)
    if (dto.masks.some((m) => m.x + m.width > 1.000001 || m.y + m.height > 1.000001))
      throw new BadRequestException('Máscara fora da imagem.')
    await this.db.transaction(async (manager) => {
      const [job]: ResearchCase[] = await manager.query(
        'SELECT * FROM research_ai_cases WHERE id=$1 FOR UPDATE',
        [id],
      )
      const [frame]: ResearchFrame[] = await manager.query(
        'SELECT * FROM research_ai_frames WHERE case_id=$1 AND id=$2 FOR UPDATE',
        [id, frameId],
      )
      if (!frame) throw new NotFoundException()
      if (job?.status !== 'REVIEW' || frame.revision !== dto.expectedRevision)
        throw new ConflictException('Recarregue a revisão antes de alterar a imagem.')
      const png = await redactResearchPng(await this.storage.read(frame.base_key), dto.masks),
        key = frame.base_key.replace('-base.png', `-r${frame.revision + 1}.png`)
      const sha = await this.storage.put(key, png)
      await manager.query(
        `UPDATE research_ai_frames SET masks=$2,revision=revision+1,reviewed_revision=NULL,redacted_key=$3,sha256=$4 WHERE id=$1`,
        [frame.id, JSON.stringify(dto.masks), key, sha],
      )
    })
    return this.research.get(id, context)
  }
  async review(id: string, frameId: string, dto: ReviewFrameDto, context: CompanyAccessContext) {
    await this.research.require(id, context)
    await this.db.transaction(async (manager) => {
      const [job]: ResearchCase[] = await manager.query(
        'SELECT * FROM research_ai_cases WHERE id=$1 FOR UPDATE',
        [id],
      )
      if (job?.status !== 'REVIEW')
        throw new ConflictException('A pesquisa não está em conferência.')
      const [rows]: [Array<{ id: string }>, number] = await manager.query(
        `UPDATE research_ai_frames SET reviewed_revision=CASE WHEN $4 THEN revision ELSE NULL END WHERE id=$1 AND case_id=$2 AND revision=$3 RETURNING id`,
        [frameId, id, dto.expectedRevision, dto.reviewed],
      )
      if (!rows.length) throw new ConflictException('A imagem mudou. Recarregue a revisão.')
    })
    return this.research.get(id, context)
  }
}
