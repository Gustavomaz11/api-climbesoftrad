import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { DataSource, type EntityManager } from 'typeorm'
import { ContrastProtocolEntity } from '../../database/entities/contrast-protocol.entity'
import { CatalogConsumerScopeService } from '../catalog-consumers/catalog-consumer-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type {
  ActivateContrastProtocolDto,
  CreateContrastProtocolDto,
  RetireContrastProtocolDto,
} from './contrast-protocol.dto'
import { validateContrastTemplate } from './contrast-template.policy'
@Injectable()
export class ContrastProtocolsService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: CatalogConsumerScopeService,
    private readonly audit: OperationalAuditService,
  ) {}
  list(context: CompanyAccessContext) {
    const query = this.database
      .getRepository(ContrastProtocolEntity)
      .createQueryBuilder('protocol')
      .where('protocol.company_id=:companyId', { companyId: context.companyId })
    if (!context.allUnits)
      query.andWhere('(protocol.unit_id IS NULL OR protocol.unit_id IN (:...units))', {
        units: context.unitIds.length ? context.unitIds : ['00000000-0000-0000-0000-000000000000'],
      })
    return query.orderBy('protocol.name', 'ASC').addOrderBy('protocol.version', 'DESC').getMany()
  }
  async require(
    id: string,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    const protocol = await manager
      .getRepository(ContrastProtocolEntity)
      .findOneBy({ id, companyId: context.companyId })
    if (
      !protocol ||
      (protocol.unitId && !context.allUnits && !context.unitIds.includes(protocol.unitId))
    )
      throw new NotFoundException('Protocolo não encontrado.')
    return protocol
  }
  async create(dto: CreateContrastProtocolDto, context: CompanyAccessContext) {
    if (dto.name.trim().length < 2)
      throw new BadRequestException('Informe um nome de protocolo válido.')
    validateContrastTemplate(dto.template, dto.fields)
    const unitId = await this.scope.unit(dto.unitId, context)
    return this.database.transaction(async (manager) => {
      const type = await this.scope.type(dto.examTypeId, context, manager)
      const previous = dto.previousId ? await this.require(dto.previousId, context, manager) : null
      if (previous && (previous.examTypeId !== type.id || previous.unitId !== unitId))
        throw new BadRequestException('Preserve tipo e unidade nas versões do protocolo.')
      const familyId = previous?.familyId ?? randomUUID()
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'contrast-protocol:' + familyId,
      ])
      const latest = await manager
        .getRepository(ContrastProtocolEntity)
        .findOne({ where: { familyId }, order: { version: 'DESC' } })
      if (previous && previous.id !== latest?.id)
        throw new ConflictException('Existe versão posterior. Recarregue o protocolo.')
      const record = await manager
        .getRepository(ContrastProtocolEntity)
        .save({
          companyId: context.companyId,
          unitId,
          examTypeId: type.id,
          modality: type.modality,
          familyId,
          version: (latest?.version ?? 0) + 1,
          stateVersion: 0,
          status: 'DRAFT',
          name: dto.name.trim(),
          template: dto.template,
          fields: dto.fields,
          notes: dto.notes,
          createdByUserId: context.userId,
        })
      await this.audit.record(
        context,
        {
          action: 'CONTRAST_PROTOCOL_CREATED',
          resourceType: 'contrast_protocol',
          resourceId: record.id,
          unitId,
          metadata: { version: record.version, examTypeId: type.id },
        },
        manager,
      )
      return record
    })
  }
  async activate(id: string, dto: ActivateContrastProtocolDto, context: CompanyAccessContext) {
    const visible = await this.require(id, context)
    await this.scope.unit(visible.unitId, context)
    return this.database.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'contrast-protocol:' + visible.familyId,
      ])
      const protocol = await this.require(id, context, manager)
      if (protocol.stateVersion !== dto.expectedStateVersion || protocol.status !== 'DRAFT')
        throw new ConflictException('Protocolo alterado ou já ativado.')
      await this.scope.type(protocol.examTypeId, context, manager)
      await this.scope.physician(dto.approvedByPhysicianId, protocol.unitId, context, manager)
      const latest = await manager
        .getRepository(ContrastProtocolEntity)
        .findOne({ where: { familyId: protocol.familyId }, order: { version: 'DESC' } })
      if (latest?.id !== id)
        throw new ConflictException('Ative a versão mais recente do protocolo.')
      const active = await manager
        .getRepository(ContrastProtocolEntity)
        .findOneBy({ familyId: protocol.familyId, status: 'ACTIVE' })
      if (active) {
        active.status = 'RETIRED'
        active.stateVersion++
        await manager.getRepository(ContrastProtocolEntity).save(active)
        await this.audit.record(
          context,
          {
            action: 'CONTRAST_PROTOCOL_RETIRED',
            resourceType: 'contrast_protocol',
            resourceId: active.id,
            unitId: active.unitId,
            reason: 'Substituído por versão aprovada',
            metadata: { replacementId: id },
          },
          manager,
        )
      }
      protocol.status = 'ACTIVE'
      protocol.stateVersion++
      protocol.approvalReference = dto.approvalReference.trim()
      if (protocol.approvalReference.length < 3)
        throw new BadRequestException('Informe a referência da revisão clínica.')
      protocol.approvedByPhysicianId = dto.approvedByPhysicianId
      protocol.activatedAt = new Date()
      await manager.getRepository(ContrastProtocolEntity).save(protocol)
      await this.audit.record(
        context,
        {
          action: 'CONTRAST_PROTOCOL_ACTIVATED',
          resourceType: 'contrast_protocol',
          resourceId: id,
          unitId: protocol.unitId,
          reason: protocol.approvalReference,
          metadata: { version: protocol.version, approvedByPhysicianId: dto.approvedByPhysicianId },
        },
        manager,
      )
      return protocol
    })
  }
  async retire(id: string, dto: RetireContrastProtocolDto, context: CompanyAccessContext) {
    const visible = await this.require(id, context)
    await this.scope.unit(visible.unitId, context)
    return this.database.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'contrast-protocol:' + visible.familyId,
      ])
      const protocol = await this.require(id, context, manager)
      if (protocol.stateVersion !== dto.expectedStateVersion || protocol.status === 'RETIRED')
        throw new ConflictException('Protocolo já alterado.')
      if (dto.reason.trim().length < 3) throw new BadRequestException('Justifique a desativação.')
      protocol.status = 'RETIRED'
      protocol.stateVersion++
      await manager.getRepository(ContrastProtocolEntity).save(protocol)
      await this.audit.record(
        context,
        {
          action: 'CONTRAST_PROTOCOL_RETIRED',
          resourceType: 'contrast_protocol',
          resourceId: id,
          unitId: protocol.unitId,
          reason: dto.reason,
        },
        manager,
      )
      return protocol
    })
  }
}
