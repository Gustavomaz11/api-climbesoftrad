import { ForbiddenException, NotFoundException } from '@nestjs/common'

export interface UnitScope {
  companyId: string
  allUnits: boolean
  unitIds: string[]
}

export const assertUnitScope = (scope: UnitScope, unit: { id: string; companyId: string }) => {
  if (unit.companyId !== scope.companyId || (!scope.allUnits && !scope.unitIds.includes(unit.id))) {
    throw new NotFoundException('Unidade não encontrada.')
  }
}

export const assertPermissionGrant = (granted: readonly string[], requested: readonly string[]) => {
  const permissions = new Set(granted)
  if (requested.some((permission) => !permissions.has(permission))) {
    throw new ForbiddenException('Você não pode conceder permissões que não possui nesta empresa.')
  }
}
