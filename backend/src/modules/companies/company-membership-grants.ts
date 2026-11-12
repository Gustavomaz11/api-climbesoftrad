import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { In, type EntityManager } from 'typeorm'
import { AccessRoleEntity } from '../../database/entities/access-role.entity'
import { HospitalUnitEntity } from '../../database/entities/hospital-unit.entity'
import { CompanyMembershipUnitEntity } from '../../database/entities/company-membership-unit.entity'
import { assertPermissionGrant, assertUnitScope } from './company-access-policy'
import type { CompanyAccessContext } from './company-context.contracts'
import type { MembershipUnitsDto } from './dto/membership.dto'

export const requireMembershipRole = async (
  manager: EntityManager,
  id: string,
  context: CompanyAccessContext,
) => {
  const role = await manager.getRepository(AccessRoleEntity).findOne({
    where: { id, companyId: context.companyId, active: true },
    relations: { permissions: true },
  })
  if (!role) throw new BadRequestException('Selecione um cargo ativo desta empresa.')
  assertPermissionGrant(
    context.permissions,
    role.permissions.map((permission) => permission.code),
  )
  return role
}

export const validateMembershipUnits = async (
  manager: EntityManager,
  dto: MembershipUnitsDto,
  context: CompanyAccessContext,
) => {
  if (dto.allUnits && !context.allUnits)
    throw new ForbiddenException('Você não pode conceder acesso a todas as unidades.')
  const ids = [...new Set(dto.unitIds ?? [])]
  const units = ids.length
    ? await manager.getRepository(HospitalUnitEntity).find({
        where: { id: In(ids), companyId: context.companyId, active: true },
      })
    : []
  if (units.length !== ids.length)
    throw new BadRequestException('Selecione unidades ativas desta empresa.')
  units.forEach((unit) => assertUnitScope(context, unit))
  return ids
}

export const saveMembershipUnits = async (
  manager: EntityManager,
  membershipId: string,
  companyId: string,
  unitIds: string[],
) => {
  const repository = manager.getRepository(CompanyMembershipUnitEntity)
  await repository.update({ membershipId, companyId }, { active: false })
  for (const unitId of unitIds) {
    await repository.upsert({ membershipId, companyId, unitId, active: true }, [
      'membershipId',
      'unitId',
    ])
  }
}
