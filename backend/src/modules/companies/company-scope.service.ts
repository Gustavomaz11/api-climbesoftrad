import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isUUID } from 'class-validator'
import { DataSource } from 'typeorm'
import { CompanyEntity } from '../../database/entities/company.entity'
import { CompanyMembershipEntity } from '../../database/entities/company-membership.entity'
import { HospitalUnitEntity } from '../../database/entities/hospital-unit.entity'
import { allPermissionCodes, type PermissionCode } from '../access-control/permission.catalog'
import type { AuthenticatedRequestData } from '../auth/auth.contracts'
import type { CompanyAccessContext, CompanyAccessSummary } from './company-context.contracts'
import { assertUnitScope } from './company-access-policy'

export interface AvailableCompany extends CompanyAccessSummary {
  permissions: PermissionCode[]
}

@Injectable()
export class CompanyScopeService {
  constructor(private readonly database: DataSource, @Optional() private readonly config?: ConfigService) {}

  get centralCompanyId() { return this.config?.get<string>('SOURAD_CENTRAL_COMPANY_ID') ?? '00000000-0000-4000-8000-000000000001' }

  async available(userId: string, isPlatformAdmin: boolean): Promise<AvailableCompany[]> {
    if (isPlatformAdmin) {
      const companies = await this.database.getRepository(CompanyEntity).find({
        where: { active: true },
        order: { name: 'ASC' },
      })
      return Promise.all(
        companies.map(async (company) => ({
          id: company.id,
          name: company.name,
          membershipId: null,
          allUnits: true,
          accessRole: { id: '', code: 'PLATFORM_ADMIN', name: 'Administrador da plataforma' },
          permissions: [...allPermissionCodes],
          units: await this.database.getRepository(HospitalUnitEntity).find({
            select: { id: true, name: true, active: true },
            where: { companyId: company.id, active: true },
            order: { name: 'ASC' },
          }),
        })),
      )
    }
    const memberships = await this.database.getRepository(CompanyMembershipEntity).find({
      where: { userId, active: true, company: { active: true }, accessRole: { active: true } },
      relations: { company: true, accessRole: { permissions: true }, unitLinks: { unit: true } },
      order: { company: { name: 'ASC' } },
    })
    return Promise.all(
      memberships.map(async (membership) => ({
        id: membership.companyId,
        name: membership.company.name,
        membershipId: membership.id,
        allUnits: membership.allUnits,
        accessRole: {
          id: membership.accessRole.id,
          code: membership.accessRole.code,
          name: membership.accessRole.name,
        },
        permissions: membership.accessRole.permissions.map(
          (permission) => permission.code,
        ) as PermissionCode[],
        units: membership.allUnits
          ? await this.database.getRepository(HospitalUnitEntity).find({
              select: { id: true, name: true, active: true },
              where: { companyId: membership.companyId, active: true },
              order: { name: 'ASC' },
            })
          : membership.unitLinks
              .filter((link) => link.active && link.unit.active)
              .map((link) => ({ id: link.unit.id, name: link.unit.name, active: link.unit.active }))
              .sort((left, right) => left.name.localeCompare(right.name)),
      })),
    )
  }

  async hasAccess(userId: string) {
    return this.database.getRepository(CompanyMembershipEntity).exists({
      where: { userId, active: true, company: { active: true }, accessRole: { active: true } },
    })
  }

  async resolve(
    auth: AuthenticatedRequestData,
    companyId?: string,
    selectedUnitId?: string,
  ): Promise<CompanyAccessContext> {
    if (companyId && !isUUID(companyId)) throw new BadRequestException('Empresa inválida.')
    if (selectedUnitId && !isUUID(selectedUnitId))
      throw new BadRequestException('Unidade inválida.')
    const available = await this.available(auth.userId, auth.isPlatformAdmin)
    const company = companyId
      ? available.find((item) => item.id === companyId)
      : available.find(item=>item.id===this.centralCompanyId) ?? (available.length === 1
        ? available[0]
        : undefined)
    if (!company) {
      if (companyId || available.length === 0)
        throw new ForbiddenException('Você não possui acesso a esta empresa.')
      throw new BadRequestException('Selecione a empresa para continuar.')
    }
    if (selectedUnitId && !company.units.some((unit) => unit.id === selectedUnitId)) {
      throw new NotFoundException('Unidade não encontrada.')
    }
    return {
      ...auth,
      companyId: company.id,
      companyName: company.name,
      membershipId: company.membershipId,
      allUnits: company.allUnits && !selectedUnitId,
      unitIds: selectedUnitId ? [selectedUnitId] : company.units.map((unit) => unit.id),
      selectedUnitId: selectedUnitId ?? null,
      accessRoleId: company.accessRole.id,
      accessRoleName: company.accessRole.name,
      permissions: company.permissions,
    }
  }

  async requireUnit(id: string, context: CompanyAccessContext) {
    const unit = await this.database.getRepository(HospitalUnitEntity).findOneBy({
      id,
      companyId: context.companyId,
    })
    if (!unit) throw new NotFoundException('Unidade não encontrada.')
    assertUnitScope(context, unit)
    return unit
  }
}
