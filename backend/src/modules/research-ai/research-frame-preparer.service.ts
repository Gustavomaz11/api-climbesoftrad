import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { OrthancArchiveService } from '../dicom/orthanc-archive.service'
import { ResearchImageStorage, redactResearchPng } from './research-image-storage.service'
import { LocalTextRedactionService } from './local-text-redaction.service'
import type { ResearchCase } from './research-ai.contracts'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class ResearchFramePreparer {
  constructor(
    private readonly archive: OrthancArchiveService,
    private readonly storage: ResearchImageStorage,
    private readonly ocr: LocalTextRedactionService,
    private readonly database: DataSource,
    private readonly config: ConfigService,
  ) {}
  async prepare(job: ResearchCase) {
    const manifest: Array<{ instanceId: string; orthancId: string; frame: number }> = []
    for (const source of job.source_snapshot) {
      if (!source.orthancId) throw new Error('ARCHIVE_PENDING')
      const frames = (await (
        await this.archive.request(`/instances/${source.orthancId}/frames`)
      ).json()) as unknown
      if (
        !Array.isArray(frames) ||
        !frames.length ||
        !frames.every((frame) => Number.isInteger(frame) && Number(frame) >= 0)
      )
        throw new Error('FRAME_MANIFEST_INVALID')
      for (const frame of frames as number[])
        manifest.push({ instanceId: source.instanceId, orthancId: source.orthancId, frame })
    }
    if (manifest.length > this.config.getOrThrow<number>('GEMINI_RESEARCH_MAX_FRAMES'))
      throw new Error('FRAME_LIMIT_EXCEEDED')
    await this.database.query('UPDATE research_ai_cases SET frames_expected=$2 WHERE id=$1', [
      job.id,
      manifest.length,
    ])
    let sequence = 0
    for (const item of manifest) {
      const response = await this.archive.request(
        `/instances/${item.orthancId}/frames/${item.frame}/preview`,
      )
      const png = await sharp(Buffer.from(await response.arrayBuffer()), {
        limitInputPixels: 64000000,
      })
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .png()
        .toBuffer()
      const metadata = await sharp(png).metadata(),
        width = metadata.width,
        height = metadata.height
      const masks = await this.ocr.detect(png, width, height),
        id = randomUUID(),
        root = `research/${job.company_id}/${job.id}/${id}`
      const redacted = await redactResearchPng(png, masks)
      await this.storage.put(root + '-base.png', png)
      const sha = await this.storage.put(root + '-r1.png', redacted)
      await this.database.query(
        `INSERT INTO research_ai_frames(id,case_id,instance_id,frame_index,sequence,width,height,base_key,redacted_key,masks,automatic_masks,sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)`,
        [
          id,
          job.id,
          item.instanceId,
          item.frame,
          ++sequence,
          width,
          height,
          root + '-base.png',
          root + '-r1.png',
          JSON.stringify(masks),
          sha,
        ],
      )
      await this.database.query(
        `UPDATE research_ai_cases SET frames_prepared=$2,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=$1`,
        [job.id, sequence],
      )
    }
    if (!sequence) throw new Error('NO_IMAGES')
  }
}
