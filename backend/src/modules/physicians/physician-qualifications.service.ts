import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource, In, type EntityManager } from 'typeorm'
import { ExamTypeEntity } from '../../database/entities/exam-type.entity'
import { PhysicianEntity } from '../../database/entities/physician.entity'
import { registryAllowsState } from './physician-registry.policy'
import { PhysicianQualificationEntity } from '../../database/entities/physician-qualification.entity'
import { CompanyMembershipReader } from '../companies/company-membership-reader'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type {
  CreatePhysicianQualificationDto,
  UpdatePhysicianQualificationDto,
} from './dto/physician-qualification.dto'

@Injectable()
export class PhysicianQualificationsService {
  constructor(
    private readonly database: DataSource,
    private readonly memberships: CompanyMembershipReader,
    private readonly scope: CompanyScopeService,
    private readonly audit: OperationalAuditService,
  ) {}

  async list(physicianId: string, context: CompanyAccessContext) {
    await this.subject(physicianId, context, this.database.manager)
    const records = await this.database.getRepository(PhysicianQualificationEntity).find({
      where: {
        physicianId,
        companyId: context.companyId,
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      relations: { examType: true, unit: true },
      order: { createdAt: 'ASC' },
    })
    return records.map((record) => ({
      id: record.id,
      unitId: record.unitId,
      unitName: record.unit.name,
      examTypeId: record.examTypeId,
      examTypeName: record.examType.name,
      modality: record.modality,
      active: record.active,
      unitActive: record.unit.active,
      typeActive: record.examType.active,
      version: record.version,
      reason: record.reason,
    }))
  }

  async create(
    physicianId: string,
    dto: CreatePhysicianQualificationDto,
    context: CompanyAccessContext,
  ) {
    const unit = await this.scope.requireUnit(dto.unitId, context)
    if (!unit.active) throw new BadRequestException('Unidade inativa.')
    try {
      return await this.database.transaction(async (manager) => {
        const { physician, membership } = await this.subject(physicianId, context, manager)
        if (!registryAllowsState(physician.registryProfile, unit.uf)) throw new BadRequestException('Médico sem inscrição regular para o estado desta unidade.')
        this.assertMembership(membership, dto.unitId)
        const type = await manager.getRepository(ExamTypeEntity).findOne({
          where: { id: dto.examTypeId, companyId: context.companyId, active: true },
          lock: { mode: 'pessimistic_read' },
        })
        if (!type) throw new BadRequestException('Tipo de exame inválido ou inativo.')
        const record = await manager.getRepository(PhysicianQualificationEntity).save({
          companyId: context.companyId,
          membershipId: membership.id,
          physicianId,
          userId: physician.userId,
          unitId: dto.unitId,
          examTypeId: type.id,
          modality: type.modality,
          active: true,
          version: 0,
          reason: dto.reason,
          createdByUserId: context.userId,
        })
        await this.record(record, context, manager)
        return { id: record.id, version: record.version }
      })
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new ConflictException('Habilitação já cadastrada. Gerencie a habilitação existente.')
      throw error
    }
  }

  async update(
    physicianId: string,
    id: string,
    dto: UpdatePhysicianQualificationDto,
    context: CompanyAccessContext,
  ) {
    return this.database.transaction(async (manager) => {
      const { physician, membership } = await this.subject(physicianId, context, manager)
      const record = await manager.getRepository(PhysicianQualificationEntity).findOne({
        where: {
          id,
          physicianId,
          companyId: context.companyId,
          ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
        },
        lock: { mode: 'pessimistic_write' },
      })
      if (!record) throw new NotFoundException('Habilitação não encontrada.')
      if (record.version !== dto.expectedVersion)
        throw new ConflictException('Habilitação alterada. Recarregue.')
      if (dto.active) {
        this.assertMembership(membership, record.unitId)
        const unit = await this.scope.requireUnit(record.unitId, context)
        if (!registryAllowsState(physician.registryProfile, unit.uf)) throw new BadRequestException('Médico sem inscrição regular para o estado desta unidade.')
        const type = await manager
          .getRepository(ExamTypeEntity)
          .findOneBy({ id: record.examTypeId, active: true })
        if (!unit.active || !type)
          throw new BadRequestException('Unidade ou tipo de exame inativo.')
      }
      record.active = dto.active
      record.reason = dto.reason
      record.version += 1
      await manager.getRepository(PhysicianQualificationEntity).save(record)
      await this.record(record, context, manager)
      return { id: record.id, version: record.version }
    })
  }

  private async subject(
    physicianId: string,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    const physician = await manager.getRepository(PhysicianEntity).findOneBy({ id: physicianId })
    if (!physician) throw new NotFoundException('Médico não encontrado.')
    const membership = await this.memberships.forUser(physician.userId, context, manager)
    return { physician, membership }
  }
  private assertMembership(
    membership: Awaited<ReturnType<CompanyMembershipReader['forUser']>>,
    unitId: string,
  ) {
    if (
      !membership.active ||
      membership.user.status !== 'ACTIVE' ||
      !membership.accessRole.active ||
      (!membership.allUnits &&
        !membership.unitLinks.some((link) => link.active && link.unitId === unitId))
    )
      throw new BadRequestException('O médico precisa de vínculo ativo nesta unidade.')
  }
  private record(
    record: PhysicianQualificationEntity,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    return this.audit.record(
      context,
      {
        action: 'PHYSICIAN_QUALIFICATION_CHANGED',
        resourceType: 'physician',
        resourceId: record.physicianId,
        unitId: record.unitId,
        reason: record.reason,
        metadata: {
          qualificationId: record.id,
          examTypeId: record.examTypeId,
          modality: record.modality,
          active: record.active,
          version: record.version,
        },
      },
      manager,
    )
  }
}
