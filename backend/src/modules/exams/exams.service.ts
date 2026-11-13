import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { PatientExamResolverService } from '../patients/patient-exam-resolver.service'
import { ExamDescriptionResolverService } from '../exam-catalog/exam-description-resolver.service'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, MoreThanOrEqual, type Repository, type EntityManager } from 'typeorm'
import { requireActiveModality } from '../exam-modalities/exam-modality.policy'
import { ExamCommentEntity } from '../../database/entities/exam-comment.entity'
import { ExamReportPresenceEntity } from '../../database/entities/exam-report-presence.entity'
import { ExamEntity } from '../../database/entities/exam.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { CreateExamDto } from './dto/create-exam.dto'
import type { ListExamsQueryDto } from './dto/list-exams-query.dto'
import { examImageSummaries } from './exam-image-summary'

const startOfNextUtcDay = (date: string) => {
  const nextDay = new Date(`${date}T00:00:00.000Z`)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  return nextDay
}

const reportPresenceTtlMs = 60_000

@Injectable()
export class ExamsService {
  constructor(
    @InjectRepository(ExamEntity)
    private readonly exams: Repository<ExamEntity>,
    @InjectRepository(ExamReportPresenceEntity)
    private readonly reportPresences: Repository<ExamReportPresenceEntity>,
    @InjectRepository(ExamCommentEntity)
    private readonly comments: Repository<ExamCommentEntity>,
    private readonly database: DataSource,
    private readonly scope: CompanyScopeService,
    private readonly audit: OperationalAuditService,
    private readonly patients: PatientExamResolverService,
    private readonly catalog: ExamDescriptionResolverService,
  ) {}

  async list(query: ListExamsQueryDto, context: CompanyAccessContext) {
    if (query.assignment === 'MINE' && context.role !== 'DOCTOR')
      throw new ForbiddenException('A fila pessoal está disponível somente para médicos.')
    const builder = this.exams
      .createQueryBuilder('exam')
      .leftJoinAndSelect('exam.unit', 'unit')
      .where('exam.company_id = :companyId', { companyId: context.companyId })
    if (!context.allUnits)
      builder.andWhere(context.unitIds.length ? 'exam.unit_id IN (:...unitIds)' : '1 = 0', {
        unitIds: context.unitIds,
      })

    if (query.assignment === 'UNASSIGNED') builder.andWhere("(exam.reporting_user_id IS NULL OR exam.workflow_state='TYPED')")
    if (query.assignment === 'MINE') {
      builder.andWhere('exam.reporting_user_id=:reportingUserId', { reportingUserId: context.userId })
      builder.andWhere("exam.archived_at IS NULL AND exam.workflow_state<>'CANCELLED'")
      builder.andWhere("(exam.workflow_state IN ('IN_PROGRESS','TYPED','REVIEW','PENDING','RECALLED') OR NOT EXISTS (SELECT 1 FROM exam_report_completions c WHERE c.id=(SELECT id FROM exam_report_completions latest WHERE latest.exam_id=exam.id ORDER BY latest.version DESC LIMIT 1) AND c.sent_at IS NOT NULL))")
    }
    if (query.workflowState) builder.andWhere('exam.workflow_state=:workflowState', { workflowState: query.workflowState })
    if (query.queue === 'ARCHIVED') builder.andWhere('exam.archived_at IS NOT NULL')
    else if (query.queue === 'HISTORY') builder.andWhere("(exam.archived_at IS NOT NULL OR exam.workflow_state='CANCELLED')")
    else if (query.queue !== 'ALL') {
      builder.andWhere("exam.archived_at IS NULL AND exam.workflow_state<>'CANCELLED'")
      if (query.queue === 'PREPARATION') builder.andWhere("exam.workflow_state IN ('TO_PREPARE','PENDING','RECALLED')")
    }

    if (query.examDate) {
      builder.andWhere('exam.performed_at >= :start AND exam.performed_at < :end', {
        start: new Date(`${query.examDate}T00:00:00.000Z`),
        end: startOfNextUtcDay(query.examDate),
      })
    } else if (query.periodDays) {
      builder.andWhere('exam.performed_at >= :periodStart', {
        periodStart: new Date(Date.now() - query.periodDays * 86_400_000),
      })
    }

    const patientName = query.patientName?.trim()
    if (patientName) {
      builder.andWhere('exam.patient_name ILIKE :patientName', {
        patientName: `%${patientName.replace(/[\\%_]/g, '\\$&')}%`,
      })
    }

    const [items, total] = await builder
      .orderBy('exam.performedAt', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount()

    return {
      items: await this.withExamMetadata(items),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  async create(dto: CreateExamDto, context: CompanyAccessContext, transaction?: EntityManager) {
    await requireActiveModality(transaction ?? this.database.manager, context.companyId, dto.modality)
    const unit = await this.scope.requireUnit(dto.unitId, context)
    if (!unit.active) throw new BadRequestException('Unidade hospitalar inválida ou inativa.')

    if (
      (dto.externalPatientId || dto.externalEncounterId || dto.sourceExamId) &&
      !dto.originIssuer?.trim()
    )
      throw new BadRequestException('Informe o sistema emissor dos identificadores de origem.')
    if (
      [dto.externalPatientId, dto.externalEncounterId, dto.sourceExamId].some(
        (value) => value !== undefined && !value.trim(),
      )
    )
      throw new BadRequestException('Identificador de origem vazio.')
    const sourceHash = createHash('sha256')
      .update(
        JSON.stringify(
          Object.keys(dto)
            .sort()
            .map((key) => [key, (dto as unknown as Record<string, unknown>)[key]]),
        ),
      )
      .digest('hex')
    const exam = this.exams.create({
      ...dto,
      companyId: context.companyId,
      originIssuer: dto.originIssuer?.trim() || null,
      externalPatientId: dto.externalPatientId ?? null,
      sourceExamId: dto.sourceExamId ?? null,
      sourcePayloadHash: dto.sourceExamId ? sourceHash : null,
      receivedPatientData: {
        fullName: dto.patientName,
        socialName: dto.socialName ?? null,
        birthDate: dto.birthDate,
        sex: dto.sex,
        identity: dto.identity ?? null,
        country: dto.country,
        email: dto.email ?? null,
        externalEncounterId: dto.externalEncounterId ?? null,
      },
      socialName: dto.socialName || null,
      identity: dto.identity || null,
      email: dto.email || null,
      code: dto.code || null,
      accessionNumber: dto.accessionNumber || null,
      orderCode: dto.orderCode || null,
      requesterReference: dto.requesterReference || null,
      requesterName: dto.requesterName || null,
      performingPhysician: dto.performingPhysician || null,
      healthInsurance: dto.healthInsurance || null,
      heightMeters: dto.heightMeters ?? null,
      weightKg: dto.weightKg ?? null,
      studyDate: dto.studyDate || null,
      studyTime: dto.studyTime || null,
      institutionName: dto.institutionName || null,
      studyId: dto.studyId || null,
      auxiliaryField1: dto.auxiliaryField1 || null,
      auxiliaryField2: dto.auxiliaryField2 || null,
      performedAt: new Date(dto.performedAt),
      createdByUserId: context.userId,
    })

    const persist = async (manager: EntityManager) => {
      if (dto.sourceExamId) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          JSON.stringify([
            'study',
            context.companyId,
            dto.unitId,
            dto.originIssuer?.trim(),
            dto.sourceExamId,
          ]),
        ])
        const previous = await manager.getRepository(ExamEntity).findOneBy({
          companyId: context.companyId,
          unitId: dto.unitId,
          originIssuer: dto.originIssuer?.trim(),
          sourceExamId: dto.sourceExamId,
        })
        if (previous) {
          if (previous.sourcePayloadHash !== sourceHash)
            throw new ConflictException(
              'Estudo de origem já recebido com dados diferentes. Encaminhe à conferência.',
            )
          return { ...previous, unit: unit.name }
        }
      }
      const patient = await this.patients.resolve(
        {
          fullName: dto.patientName,
          socialName: dto.socialName,
          birthDate: dto.birthDate,
          sex: dto.sex,
          country: dto.country,
          email: dto.email,
          patientId: dto.patientId,
          unitId: dto.unitId,
          originIssuer: dto.originIssuer?.trim(),
          externalPatientId: dto.externalPatientId,
          externalEncounterId: dto.externalEncounterId,
          performedAt: dto.performedAt,
        },
        context,
        manager,
      )
      const classification = await this.catalog.resolve(
        dto.studyDescription,
        dto.modality,
        dto.unitId,
        dto.originIssuer?.trim(),
        context,
        manager,
        dto.examTypeId,
      )
      Object.assign(exam, patient, {
        examTypeId: classification.examTypeId,
        normalizationStatus: classification.status,
        normalizationAliasId: 'aliasId' in classification ? classification.aliasId : null,
        normalizationRuleVersion: classification.ruleVersion,
      })
      const saved = await manager.getRepository(ExamEntity).save(exam)
      await manager.query(
        `UPDATE patient_reviews SET exam_id=$1 WHERE patient_id=$2 AND exam_id IS NULL AND status='OPEN'`,
        [saved.id, saved.patientId],
      )
      await this.audit.record(
        context,
        {
          action: 'EXAM_CREATED',
          resourceType: 'exam',
          resourceId: saved.id,
          unitId: saved.unitId,
        },
        manager,
      )
      return { ...saved, unit: unit.name }
    }
    return transaction ? persist(transaction) : this.database.transaction(persist)
  }

  private async withExamMetadata(exams: ExamEntity[]) {
    if (exams.length === 0) return []

    const activeSince = new Date(Date.now() - reportPresenceTtlMs)
    const examIds = exams.map((exam) => exam.id)
    const [presences, commentCounts,images] = await Promise.all([
      this.reportPresences.find({
        where: { examId: In(examIds), lastSeenAt: MoreThanOrEqual(activeSince) },
        relations: { user: true },
        order: { lastSeenAt: 'DESC' },
      }),
      this.comments
        .createQueryBuilder('comment')
        .select('comment.exam_id', 'examId')
        .addSelect('COUNT(*)', 'commentCount')
        .where('comment.exam_id IN (:...examIds)', { examIds })
        .groupBy('comment.exam_id')
        .getRawMany<{ examId: string; commentCount: string }>(),
      examImageSummaries(this.database,examIds),
    ])
    const reportingUserByExam = new Map<string, string>()
    for (const presence of presences) {
      if (!reportingUserByExam.has(presence.examId)) {
        reportingUserByExam.set(presence.examId, presence.user.fullName)
      }
    }
    const commentCountByExam = new Map(
      commentCounts.map((item) => [item.examId, Number(item.commentCount)]),
    )

    const completions = await this.database.query<Array<{ exam_id: string; id: string; sent_at: Date | null; finalized_at: Date; origin_unit_id: string | null }>>(
      'SELECT DISTINCT ON(exam_id) exam_id,id,sent_at,finalized_at,origin_unit_id FROM exam_report_completions WHERE exam_id=ANY($1::uuid[]) ORDER BY exam_id,version DESC', [examIds])
    const completionByExam = new Map(completions.map(row => [row.exam_id, row]))
    const owners = await this.database.query<Array<{ id: string; full_name: string }>>(
      'SELECT id,full_name FROM auth_users WHERE id=ANY($1::uuid[])',
      [exams.flatMap(exam => exam.reportingUserId ? [exam.reportingUserId] : [])],
    )
    const ownerNames = new Map(owners.map(owner => [owner.id, owner.full_name]))
    const recalls=await this.database.query<Array<{exam_id:string;recall_purpose:string}>>('SELECT DISTINCT ON(exam_id) exam_id,recall_purpose FROM exam_workflow_issues WHERE exam_id=ANY($1::uuid[]) AND kind=$2 AND resolved_at IS NULL ORDER BY exam_id,opened_at DESC',[examIds,'RECALL'])
    const recallByExam=new Map(recalls.map(row=>[row.exam_id,row.recall_purpose]))
    return exams.map((exam) => ({
      ...exam,
      unit: exam.unit.internalIdentifier?.trim() || exam.unit.name,
      unitName: exam.unit.name,
      unitInternalIdentifier: exam.unit.internalIdentifier,
      reportingUserName: (exam.reportingUserId ? ownerNames.get(exam.reportingUserId) : null) ?? reportingUserByExam.get(exam.id) ?? null,
      recallPurpose:recallByExam.get(exam.id)??null,
      commentCount: commentCountByExam.get(exam.id) ?? 0,
      imageStatus:images.get(exam.id)?.imageStatus??'NO_IMAGES',
      imageSeriesCount:images.get(exam.id)?.imageSeriesCount??0,
      imageInstanceCount:images.get(exam.id)?.imageInstanceCount??0,
      lastImageReceivedAt:images.get(exam.id)?.lastImageReceivedAt??null,
      reportCompletionId: completionByExam.get(exam.id)?.id ?? null,
      reportFinalizedAt: completionByExam.get(exam.id)?.finalized_at ?? null,
      reportSentAt: completionByExam.get(exam.id)?.sent_at ?? null,
      reportHasOrigin: Boolean(completionByExam.get(exam.id)?.origin_unit_id),
    }))
  }
}
