import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import { ExamEntity } from '../../database/entities/exam.entity'
import { ExamTypeEntity } from '../../database/entities/exam-type.entity'
import { ExamTypeAliasEntity } from '../../database/entities/exam-type-alias.entity'
import { PhysicianQualificationEntity } from '../../database/entities/physician-qualification.entity'
import { ContrastProtocolEntity } from '../../database/entities/contrast-protocol.entity'
import { ExamPriceRuleEntity } from '../../database/entities/exam-price-rule.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { normalizeExamDescription } from './exam-description.policy'
import type { SaveExamTypeDto, SaveExamAliasDto } from './dto/exam-catalog.dto'
import { requireActiveModality } from '../exam-modalities/exam-modality.policy'
@Injectable()
export class ExamCatalogService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: CompanyScopeService,
    private readonly audit: OperationalAuditService,
  ) {}
  async list(context: CompanyAccessContext) {
    const [types, aliases] = await Promise.all([
      this.database
        .getRepository(ExamTypeEntity)
        .find({ where: { companyId: context.companyId }, order: { name: 'ASC' } }),
      this.database.getRepository(ExamTypeAliasEntity).findBy({ companyId: context.companyId }),
    ])
    return {
      types,
      aliases: aliases.filter(
        (a) => context.allUnits || a.unitId === null || context.unitIds.includes(a.unitId),
      ),
    }
  }
  async saveType(id: string | undefined, dto: SaveExamTypeDto, context: CompanyAccessContext) {
    if (!context.allUnits)
      throw new ForbiddenException(
        'Selecione todas as unidades para administrar o catálogo da empresa.',
      )
    try {
      return await this.database.transaction(async (manager) => {
        if (dto.active) await requireActiveModality(manager, context.companyId, dto.modality)
        const repo = manager.getRepository(ExamTypeEntity)
        let record = id
          ? await repo.findOne({
              where: { id, companyId: context.companyId },
              lock: { mode: 'pessimistic_write' },
            })
          : repo.create({ companyId: context.companyId, version: 0 })
        if (!record) throw new NotFoundException('Tipo não encontrado.')
        if (id && record.version !== dto.expectedVersion)
          throw new ConflictException('Tipo alterado. Recarregue.')
        if (
          id &&
          record.modality !== dto.modality &&
          ((await manager.getRepository(ExamEntity).existsBy({ examTypeId: id })) ||
           (await manager.getRepository(PhysicianQualificationEntity).existsBy({ examTypeId: id })) ||
           (await manager.getRepository(ContrastProtocolEntity).existsBy({ examTypeId: id })) ||
           (await manager.getRepository(ExamPriceRuleEntity).existsBy({ examTypeId: id })))
        )
          throw new ConflictException(
            'Modalidade de tipo já utilizado não pode mudar. Cadastre outro tipo.',
          )
        Object.assign(record, {
          name: dto.name.trim(),
          modality: dto.modality,
          groupName: dto.groupName.trim(),
          active: dto.active,
          version: id ? record.version + 1 : 0,
        })
        record = await repo.save(record)
        if (id)
          await manager
            .getRepository(ExamTypeAliasEntity)
            .update({ examTypeId: id }, { modality: record.modality })
        await this.audit.record(
          context,
          {
            action: id ? 'EXAM_TYPE_UPDATED' : 'EXAM_TYPE_CREATED',
            resourceType: 'exam_type',
            resourceId: record.id,
            metadata: { version: record.version },
          },
          manager,
        )
        return record
      })
    } catch (error: unknown) {
      this.conflict(error)
    }
  }
  async saveAlias(id: string | undefined, dto: SaveExamAliasDto, context: CompanyAccessContext) {
    if (dto.unitId) await this.scope.requireUnit(dto.unitId, context)
    else if (!context.allUnits)
      throw new ForbiddenException('Mapeamento da empresa exige acesso a todas as unidades.')
    try {
      return await this.database.transaction((manager) =>
        this.aliasInTransaction(id, dto, context, manager),
      )
    } catch (error: unknown) {
      this.conflict(error)
    }
  }
  async aliasInTransaction(
    id: string | undefined,
    dto: SaveExamAliasDto,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    const type = await manager
      .getRepository(ExamTypeEntity)
      .findOneBy({ id: dto.examTypeId, companyId: context.companyId })
    if (!type || !type.active) throw new NotFoundException('Tipo ativo não encontrado.')
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      JSON.stringify([
        'exam-alias',
        context.companyId,
        dto.unitId ?? null,
        dto.issuer?.trim() || null,
        normalizeExamDescription(dto.description),
        type.modality,
      ]),
    ])
    const repo = manager.getRepository(ExamTypeAliasEntity)
    let alias = id
      ? await repo.findOne({
          where: { id, companyId: context.companyId },
          lock: { mode: 'pessimistic_write' },
        })
      : repo.create({ companyId: context.companyId, version: 0 })
    if (!alias) throw new NotFoundException('Sinônimo não encontrado.')
    if (alias.unitId) await this.scope.requireUnit(alias.unitId, context)
    else if (id && !context.allUnits)
      throw new ForbiddenException('Mapeamento da empresa exige acesso completo.')
    if (id && alias.version !== dto.expectedVersion)
      throw new ConflictException('Sinônimo alterado. Recarregue.')
    Object.assign(alias, {
      examTypeId: type.id,
      unitId: dto.unitId ?? null,
      issuer: dto.issuer?.trim() || null,
      description: dto.description,
      normalizedDescription: normalizeExamDescription(dto.description),
      modality: type.modality,
      active: dto.active,
      version: alias.version + 1,
    })
    alias = await repo.save(alias)
    await this.audit.record(
      context,
      {
        action: 'EXAM_TYPE_ALIAS_UPDATED',
        resourceType: 'exam_type_alias',
        resourceId: alias.id,
        unitId: alias.unitId,
        metadata: { version: alias.version },
      },
      manager,
    )
    return alias
  }
  async learnAlias(dto: SaveExamAliasDto, context: CompanyAccessContext, manager: EntityManager) {
    const type = await manager
      .getRepository(ExamTypeEntity)
      .findOneByOrFail({ id: dto.examTypeId, companyId: context.companyId })
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      JSON.stringify([
        'exam-alias',
        context.companyId,
        dto.unitId ?? null,
        dto.issuer?.trim() || null,
        normalizeExamDescription(dto.description),
        type.modality,
      ]),
    ])
    const repo = manager.getRepository(ExamTypeAliasEntity)
    const aliases = await repo
      .createQueryBuilder('alias')
      .where(
        'alias.company_id=:companyId AND alias.modality=:modality AND alias.normalized_description=:description AND alias.unit_id IS NOT DISTINCT FROM :unitId AND alias.issuer IS NOT DISTINCT FROM :issuer',
        {
          companyId: context.companyId,
          modality: type.modality,
          description: normalizeExamDescription(dto.description),
          unitId: dto.unitId ?? null,
          issuer: dto.issuer?.trim() || null,
        },
      )
      .orderBy('alias.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany()
    for (const alias of aliases.filter((a) => a.active && a.examTypeId !== type.id)) {
      alias.active = false
      alias.version++
      await repo.save(alias)
      await this.audit.record(
        context,
        {
          action: 'EXAM_TYPE_ALIAS_UPDATED',
          resourceType: 'exam_type_alias',
          resourceId: alias.id,
          unitId: alias.unitId,
          metadata: { version: alias.version, active: false },
        },
        manager,
      )
    }
    const chosen = aliases.find((a) => a.examTypeId === type.id)
    return this.aliasInTransaction(
      chosen?.id,
      { ...dto, expectedVersion: chosen?.version },
      context,
      manager,
    )
  }
  private conflict(error: unknown): never {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new ConflictException('Tipo ou sinônimo já cadastrado para esta origem.')
    throw error
  }
}
