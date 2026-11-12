import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource } from 'typeorm'
import { ExamPriceRuleEntity } from '../../database/entities/exam-price-rule.entity'
import { CatalogConsumerScopeService } from '../catalog-consumers/catalog-consumer-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { ExamAccessService } from '../exams/exam-access.service'
import type { CloseExamPriceDto, CreateExamPriceDto, ResolveExamPriceDto } from './exam-price.dto'
import { amountToCents, choosePriceRule } from './exam-price.policy'
@Injectable()
export class ExamPricingService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: CatalogConsumerScopeService,
    private readonly audit: OperationalAuditService,
    private readonly exams: ExamAccessService,
  ) {}
  private administrative(context: CompanyAccessContext) {
    if (context.role === 'DOCTOR')
      throw new ForbiddenException('Preços são administrados por perfis administrativos.')
  }
  async list(context: CompanyAccessContext) {
    this.administrative(context)
    const query = this.database
      .getRepository(ExamPriceRuleEntity)
      .createQueryBuilder('price')
      .where('price.company_id=:companyId', { companyId: context.companyId })
    if (!context.allUnits)
      query.andWhere('(price.unit_id IS NULL OR price.unit_id IN (:...units))', {
        units: context.unitIds.length ? context.unitIds : ['00000000-0000-0000-0000-000000000000'],
      })
    return query.orderBy('price.created_at', 'DESC').getMany()
  }
  async create(dto: CreateExamPriceDto, context: CompanyAccessContext) {
    this.administrative(context)
    if (dto.reason.trim().length < 3)
      throw new BadRequestException('Informe uma justificativa válida.')
    if (dto.kind === 'BILLING' && dto.physicianId)
      throw new BadRequestException('Faturamento não possui médico beneficiário.')
    if (dto.validTo && dto.validTo < dto.validFrom)
      throw new BadRequestException('Vigência final anterior ao início.')
    const unitId = await this.scope.unit(dto.unitId, context),
      amountCents = amountToCents(dto.amount)
    try {
      return await this.database.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          JSON.stringify([
            'exam-price',
            context.companyId,
            dto.examTypeId,
            dto.kind,
            unitId,
            dto.physicianId ?? null,
          ]),
        ])
        const type = await this.scope.type(dto.examTypeId, context, manager)
        if (dto.physicianId) await this.scope.physician(dto.physicianId, unitId, context, manager)
        const record = await manager
          .getRepository(ExamPriceRuleEntity)
          .save({
            companyId: context.companyId,
            unitId,
            physicianId: dto.physicianId ?? null,
            examTypeId: type.id,
            modality: type.modality,
            kind: dto.kind,
            currency: dto.currency,
            amountCents,
            validFrom: dto.validFrom,
            validTo: dto.validTo ?? null,
            version: 0,
            reason: dto.reason.trim(),
            createdByUserId: context.userId,
          })
        await this.audit.record(
          context,
          {
            action: 'EXAM_PRICE_CREATED',
            resourceType: 'exam_price',
            resourceId: record.id,
            unitId,
            reason: record.reason,
            metadata: {
              kind: record.kind,
              examTypeId: type.id,
              amountCents,
              currency: record.currency,
            },
          },
          manager,
        )
        return record
      })
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23P01')
        throw new ConflictException(
          'Já existe preço no mesmo escopo com vigência sobreposta. Encerre a regra anterior.',
        )
      throw error
    }
  }
  async close(id: string, dto: CloseExamPriceDto, context: CompanyAccessContext) {
    this.administrative(context)
    if (dto.reason.trim().length < 3)
      throw new BadRequestException('Informe uma justificativa válida.')
    return this.database.transaction(async (manager) => {
      const record = await manager
        .getRepository(ExamPriceRuleEntity)
        .findOne({
          where: { id, companyId: context.companyId },
          lock: { mode: 'pessimistic_write' },
        })
      if (!record) throw new NotFoundException('Regra de preço não encontrada.')
      await this.scope.unit(record.unitId, context)
      if (record.version !== dto.expectedVersion)
        throw new ConflictException('Regra já alterada. Recarregue.')
      if (dto.validTo < record.validFrom || (record.validTo && dto.validTo > record.validTo))
        throw new BadRequestException('O encerramento deve reduzir uma vigência válida.')
      const previousEnd = record.validTo
      record.validTo = dto.validTo
      record.version++
      await manager.getRepository(ExamPriceRuleEntity).save(record)
      await this.audit.record(
        context,
        {
          action: 'EXAM_PRICE_CLOSED',
          resourceType: 'exam_price',
          resourceId: id,
          unitId: record.unitId,
          reason: dto.reason,
          metadata: { previousEnd, validTo: record.validTo, version: record.version },
        },
        manager,
      )
      return record
    })
  }
  async resolve(dto: ResolveExamPriceDto, context: CompanyAccessContext) {
    this.administrative(context)
    const exam = await this.exams.require(dto.examId, context)
    if (exam.normalizationStatus !== 'APPROVED' || !exam.examTypeId)
      return { billing: null, payout: null, reason: 'CLASSIFICATION_REQUIRED' }
    if (dto.physicianId) await this.scope.physician(dto.physicianId, exam.unitId, context)
    const rules = (await this.list(context)).filter(
      (rule) => rule.examTypeId === exam.examTypeId && rule.modality === exam.modality,
    )
    const billing = choosePriceRule(
      rules.filter((rule) => rule.kind === 'BILLING'),
      exam.unitId,
      null,
      dto.date,
    )
    const payout = choosePriceRule(
      rules.filter((rule) => rule.kind === 'PAYOUT'),
      exam.unitId,
      dto.physicianId ?? null,
      dto.date,
    )
    return {
      billing,
      payout,
      date: dto.date,
      reason: billing && payout ? null : 'MISSING_PRICE_RULE',
    }
  }
}
