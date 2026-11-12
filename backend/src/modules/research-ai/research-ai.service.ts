import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomUUID } from 'node:crypto'
import { DataSource } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { ExamAccessService } from '../exams/exam-access.service'
import { UploadLiveContextService } from '../document-uploads/upload-live-context.service'
import { GeminiResearchClient } from './gemini-research.client'
import { retryableResearchErrors } from './gemini-errors'
import {
  anonymizationVersion,
  researchPromptVersion,
  type ResearchCase,
  type ResearchFrame,
  type ResearchSource,
} from './research-ai.contracts'
import type { ResearchFeedbackDto as FeedbackDto, RunResearchDto } from './research-ai.dto'

@Injectable()
export class ResearchAiService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly access: ExamAccessService,
    private readonly live: UploadLiveContextService,
    private readonly gemini: GeminiResearchClient,
  ) {}

  async scope(examId: string, context: CompanyAccessContext) {
    if (
      context.companyId !== this.config.get<string>('SOURAD_CENTRAL_COMPANY_ID') ||
      !(['research.ai.use', 'exams.view', 'exams.viewer.open'] as const).every((p) =>
        context.permissions.includes(p),
      )
    )
      throw new ForbiddenException()
    return this.access.require(examId, context)
  }
  async snapshot(examId: string, companyId: string) {
    const sources: ResearchSource[] = await this.db.query(
      `SELECT i.id AS "instanceId",i.orthanc_id AS "orthancId",i.instance_uid AS "instanceUid",o.sha256
      FROM dicom_instances i JOIN dicom_studies s ON s.id=i.study_id JOIN stored_objects o ON o.id=i.object_id
      WHERE s.exam_id=$1 AND s.company_id=$2 ORDER BY i.id`,
      [examId, companyId],
    )
    return { sources, hash: createHash('sha256').update(JSON.stringify(sources)).digest('hex') }
  }
  async require(id: string, context: CompanyAccessContext) {
    const [job]: ResearchCase[] = await this.db.query(
      'SELECT * FROM research_ai_cases WHERE id=$1 AND company_id=$2',
      [id, context.companyId],
    )
    if (!job) throw new NotFoundException('Pesquisa não encontrada.')
    await this.scope(job.exam_id, context)
    return job
  }
  async validateLive(job: ResearchCase) {
    await this.scope(job.exam_id, await this.live.user(job.context))
    if ((await this.snapshot(job.exam_id, job.company_id)).hash !== job.source_hash)
      throw new Error('SOURCE_CHANGED')
  }
  async create(examId: string, context: CompanyAccessContext) {
    const exam = await this.scope(examId, context)
    if (!this.gemini.enabled)
      throw new ServiceUnavailableException('Pesquisa com Gemini não está habilitada.')
    const { sources, hash } = await this.snapshot(examId, context.companyId)
    if (!sources.length)
      throw new ConflictException('O exame ainda não tem imagens recebidas pela SouRad.')
    if (sources.some((source) => !source.orthancId))
      throw new ConflictException('Aguarde todas as imagens ficarem disponíveis no visualizador.')
    await this.db.query(
      `UPDATE research_ai_cases SET status='STALE',error_code='ANONYMIZATION_UPDATED',updated_at=now()
      WHERE exam_id=$1 AND created_by_user_id=$2 AND status IN ('PREPARING','REVIEW') AND (anonymization_version<>$3 OR prompt_version<>$4)`,
      [examId, context.userId, anonymizationVersion, researchPromptVersion],
    )
    const [row] = await this.db.query<Array<{ id: string }>>(
      `INSERT INTO research_ai_cases(id,company_id,unit_id,exam_id,created_by_user_id,context,source_hash,source_snapshot,status,model,prompt_version,anonymization_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PREPARING',$9,$10,$11)
      ON CONFLICT (exam_id,created_by_user_id) WHERE status IN ('PREPARING','REVIEW','QUEUED','RUNNING') DO UPDATE SET updated_at=research_ai_cases.updated_at RETURNING id`,
      [
        randomUUID(),
        context.companyId,
        exam.unitId,
        examId,
        context.userId,
        JSON.stringify(context),
        hash,
        JSON.stringify(sources),
        this.gemini.model,
        researchPromptVersion,
        anonymizationVersion,
      ],
    )
    return this.get(row!.id, context)
  }
  async list(examId: string, context: CompanyAccessContext) {
    await this.scope(examId, context)
    return {
      enabled: this.gemini.enabled,
      anonymizationVersion,
      promptVersion: researchPromptVersion,
      items: await this.db.query<
        Array<{ id: string; status: string; model: string; promptVersion: string; createdAt: Date }>
      >(
        `SELECT id,status,model,prompt_version AS "promptVersion",anonymization_version AS "anonymizationVersion",created_at AS "createdAt" FROM research_ai_cases WHERE exam_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 50`,
        [examId, context.companyId],
      ),
    }
  }
  async get(id: string, context: CompanyAccessContext) {
    const job = await this.require(id, context),
      frames = await this.frames(id)
    const [feedback] = await this.db.query<Array<{ useful: boolean; comment: string }>>(
      'SELECT useful,comment FROM research_ai_feedback WHERE case_id=$1 AND user_id=$2',
      [id, context.userId],
    )
    const sourceCurrent = (await this.snapshot(job.exam_id, job.company_id)).hash === job.source_hash
    const [coverage] = await this.db.query<Array<{ count: number }>>(
      'SELECT coalesce(sum(cardinality(image_ids)),0)::int AS count FROM research_ai_batches WHERE case_id=$1',
      [id],
    )
    return {
      id: job.id,
      sourceCaseId: job.source_case_id ?? null,
      sourceCurrent,
      canReanalyze:
        sourceCurrent &&
        this.gemini.enabled &&
        job.anonymization_version === anonymizationVersion &&
        ['COMPLETED', 'FAILED'].includes(job.status) &&
        frames.length === job.frames_expected &&
        frames.length > 0 &&
        frames.every((f) => f.reviewed_revision === f.revision),
      examId: job.exam_id,
      status: job.status,
      model: job.model,
      promptVersion: job.prompt_version,
      anonymizationVersion: job.anonymization_version,
      framesExpected: job.frames_expected,
      framesPrepared: job.frames_prepared,
      framesAnalyzed: coverage?.count ?? 0,
      batchesCompleted: job.batches_completed,
      result: job.status === 'COMPLETED' ? job.result : null,
      errorCode: job.error_code,
      canRetry:
        job.status === 'FAILED' &&
        job.anonymization_version === anonymizationVersion &&
        job.prompt_version === researchPromptVersion &&
        retryableResearchErrors.has(job.error_code || ''),
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      feedback: feedback ?? null,
      frames: frames.map((f) => ({
        id: f.id,
        sequence: f.sequence,
        instanceUid: f.instance_uid,
        seriesUid: f.series_uid,
        studyUid: f.study_uid,
        frameIndex: f.frame_index,
        width: f.width,
        height: f.height,
        masks: f.masks,
        automaticMasks: f.automatic_masks,
        revision: f.revision,
        reviewed: f.reviewed_revision === f.revision,
      })),
    }
  }
  frames(id: string): Promise<ResearchFrame[]> {
    return this.db.query(
      `SELECT f.*,i.instance_uid,s.series_uid,t.study_uid FROM research_ai_frames f
      JOIN dicom_instances i ON i.id=f.instance_id JOIN dicom_series s ON s.id=i.series_id JOIN dicom_studies t ON t.id=i.study_id
      WHERE f.case_id=$1 ORDER BY f.sequence`,
      [id],
    )
  }
  async run(id: string, dto: RunResearchDto, context: CompanyAccessContext) {
    const job = await this.require(id, context)
    if (
      job.anonymization_version !== anonymizationVersion ||
      job.prompt_version !== researchPromptVersion
    )
      throw new ConflictException('Prepare uma nova análise com a anonimização atualizada.')
    if (!dto.confirmsAnonymization || !dto.nonClinicalResearch)
      throw new BadRequestException('Confirme a anonimização e a finalidade de pesquisa.')
    if (!this.gemini.enabled) throw new ServiceUnavailableException('Pesquisa desabilitada.')
    try {
      await this.validateLive({ ...job, context })
    } catch (error) {
      if (error instanceof Error && error.message === 'SOURCE_CHANGED') {
        await this.db.query(
          "UPDATE research_ai_cases SET status='STALE',error_code='SOURCE_CHANGED',updated_at=now() WHERE id=$1 AND status='REVIEW'",
          [id],
        )
        throw new ConflictException('O exame mudou. Prepare uma nova pesquisa.')
      }
      throw error
    }
    const [changed]: [Array<{ id: string }>, number] = await this.db.query(
      `UPDATE research_ai_cases SET status='QUEUED',context=$2,updated_at=now() WHERE id=$1 AND status='REVIEW'
      AND frames_expected>0 AND frames_expected=frames_prepared
      AND (SELECT count(*) FROM research_ai_frames WHERE case_id=$1)=frames_expected
      AND NOT EXISTS(SELECT 1 FROM research_ai_frames WHERE case_id=$1 AND reviewed_revision IS DISTINCT FROM revision) RETURNING id`,
      [id, JSON.stringify(context)],
    )
    if (!changed.length)
      throw new ConflictException('Revise e confirme todas as imagens antes do envio.')
    return this.get(id, context)
  }
  async feedback(id: string, dto: FeedbackDto, context: CompanyAccessContext) {
    const job = await this.require(id, context)
    if (job.status !== 'COMPLETED')
      throw new ConflictException('A pesquisa precisa estar concluída.')
    await this.db.query(
      `INSERT INTO research_ai_feedback(case_id,user_id,useful,comment) VALUES($1,$2,$3,$4)
      ON CONFLICT(case_id,user_id) DO UPDATE SET useful=excluded.useful,comment=excluded.comment,updated_at=now()`,
      [id, context.userId, dto.useful, dto.comment ?? ''],
    )
    return this.get(id, context)
  }
  async retry(id: string, context: CompanyAccessContext) {
    const job = await this.require(id, context)
    if (job.status !== 'FAILED' || !retryableResearchErrors.has(job.error_code || ''))
      throw new ConflictException(
        'Esta falha exige uma nova preparação ou correção antes de retomar.',
      )
    if (
      job.anonymization_version !== anonymizationVersion ||
      job.prompt_version !== researchPromptVersion
    )
      throw new ConflictException('Prepare uma nova análise com a anonimização atualizada.')
    try {
      await this.validateLive({ ...job, context })
    } catch (error) {
      if (error instanceof Error && error.message === 'SOURCE_CHANGED') {
        await this.db.query(
          "UPDATE research_ai_cases SET status='STALE',error_code='SOURCE_CHANGED',updated_at=now() WHERE id=$1 AND status='FAILED'",
          [id],
        )
        throw new ConflictException('O exame mudou. Prepare uma nova análise com todas as imagens.')
      }
      throw error
    }
    const [rows]: [Array<{ id: string }>, number] = await this.db.query(
      `UPDATE research_ai_cases SET status='QUEUED',error_code=NULL,context=$2,lease_until=NULL,updated_at=now()
      WHERE id=$1 AND status='FAILED' AND frames_expected>0 AND frames_expected=frames_prepared
      AND (SELECT count(*) FROM research_ai_frames WHERE case_id=$1)=frames_expected
      AND NOT EXISTS(SELECT 1 FROM research_ai_frames WHERE case_id=$1 AND reviewed_revision IS DISTINCT FROM revision) RETURNING id`,
      [id, JSON.stringify(context)],
    )
    if (!rows.length)
      throw new ConflictException(
        'A conferência das imagens precisa estar completa antes de retomar.',
      )
    return this.get(id, context)
  }
}
