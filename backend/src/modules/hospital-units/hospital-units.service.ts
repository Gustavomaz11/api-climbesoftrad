import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource, In } from 'typeorm'
import { HospitalUnitEntity } from '../../database/entities/hospital-unit.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CreateHospitalUnitDto } from './dto/create-hospital-unit.dto'
import { normalizeCnpj, validCnpj } from './cnpj.policy'
import { RouterConnectionsService } from '../router/router-connections.service'
import { RouterInstallerService } from '../router/router-installer.service'

@Injectable()
export class HospitalUnitsService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: CompanyScopeService,
    private readonly audit: OperationalAuditService,
    private readonly connections: RouterConnectionsService,
    private readonly installers: RouterInstallerService,
    private readonly config: ConfigService,
  ) {}

  list(context: CompanyAccessContext) {
    return this.database.getRepository(HospitalUnitEntity).find({
      where: {
        companyId: context.companyId,
        active: true,
        ...(context.allUnits ? {} : { id: In(context.unitIds) }),
      },
      order: { name: 'ASC' },
    })
  }

  async listAll(context: CompanyAccessContext) {
    const units = await this.database.getRepository(HospitalUnitEntity).find({
      where: {
        companyId: context.companyId,
        ...(context.allUnits ? {} : { id: In(context.unitIds) }),
      },
      order: { name: 'ASC' },
    })
    const connections = await this.connections.forUnits(context.companyId, units.map(unit => unit.id))
    return units.map(unit => ({ ...unit, router: connections.get(unit.id) ?? { status: 'NOT_INSTALLED', installed: 0, lastSeenAt: null } }))
  }

  async create(dto: CreateHospitalUnitDto, context: CompanyAccessContext) {
    this.validateCompany(dto)
    if (!context.allUnits)
      throw new ForbiddenException('Selecione todas as unidades para cadastrar uma unidade.')
    try {
      const created = await this.database.transaction(async (manager) => {
        const repository = manager.getRepository(HospitalUnitEntity)
        const unit = await repository.save(
          repository.create({
            companyId: context.companyId,
            name: dto.name.trim().replace(/\s+/g, ' '),
            uf: dto.uf ?? null,
            ...this.companyFields(dto),
          }),
        )
        await this.audit.record(
          context,
          {
            action: 'UNIT_CREATED',
            resourceType: 'unit',
            resourceId: unit.id,
            unitId: unit.id,
          },
          manager,
        )
        return unit
      })
      if (dto.cnpj && this.config.get<string>('NODE_ENV') !== 'test') {
        try { await this.installers.prepare(created.id, context) }
        catch { Logger.error('Não foi possível preparar o Router da unidade; o download permite tentar novamente.', 'HospitalUnitsService') }
      }
      return created
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new ConflictException('Já existe uma unidade com este nome nesta empresa.')
      }
      throw error
    }
  }

  async update(id: string, dto: CreateHospitalUnitDto, context: CompanyAccessContext) {
    this.validateCompany(dto)
    const unit = await this.scope.requireUnit(id, context)
    try {
      return await this.database.transaction(async (manager) => {
        unit.name = dto.name.trim().replace(/\s+/g, ' ')
        if (dto.uf !== undefined) unit.uf = dto.uf
        Object.assign(unit, this.companyFields(dto))
        await manager.getRepository(HospitalUnitEntity).save(unit)
        await this.audit.record(
          context,
          {
            action: 'UNIT_UPDATED',
            resourceType: 'unit',
            resourceId: id,
            unitId: id,
          },
          manager,
        )
        return unit
      })
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new ConflictException('Já existe uma unidade com este nome nesta empresa.')
      }
      throw error
    }
  }

  revoke(id: string, context: CompanyAccessContext) {
    return this.setActive(id, false, context)
  }
  private validateCompany(dto: CreateHospitalUnitDto) {
    if (dto.cnpj !== undefined && !validCnpj(dto.cnpj)) throw new BadRequestException('CNPJ inválido.')
    if (dto.cnpj && (!dto.legalName?.trim() || !dto.internalIdentifier?.trim() || !dto.uf || !dto.address || !dto.contactPhone?.trim() || !dto.contactEmail?.trim()))
      throw new BadRequestException('Complete os dados da empresa, endereço, contato e identificador interno.')
  }
  private companyFields(dto: CreateHospitalUnitDto) {
    const values: Partial<HospitalUnitEntity> = {}
    if (dto.cnpj !== undefined) values.cnpj = normalizeCnpj(dto.cnpj)
    if (dto.legalName !== undefined) values.legalName = dto.legalName.trim()
    if (dto.tradeName !== undefined) values.tradeName = dto.tradeName.trim()
    if (dto.internalIdentifier !== undefined) values.internalIdentifier = dto.internalIdentifier.trim()
    if (dto.address !== undefined) values.address = dto.address
    if (dto.contactPhone !== undefined) values.contactPhone = dto.contactPhone.trim()
    if (dto.contactEmail !== undefined) values.contactEmail = dto.contactEmail.trim()
    return values
  }
  reactivate(id: string, context: CompanyAccessContext) {
    return this.setActive(id, true, context)
  }

  private async setActive(id: string, active: boolean, context: CompanyAccessContext) {
    const unit = await this.scope.requireUnit(id, context)
    return this.database.transaction(async (manager) => {
      if (unit.active === active) return unit
      unit.active = active
      await manager.getRepository(HospitalUnitEntity).save(unit)
      await this.audit.record(
        context,
        {
          action: 'UNIT_STATUS_CHANGED',
          resourceType: 'unit',
          resourceId: id,
          unitId: id,
          metadata: { active },
        },
        manager,
      )
      return unit
    })
  }
}
