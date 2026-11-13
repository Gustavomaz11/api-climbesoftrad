import { BadRequestException, ForbiddenException } from '@nestjs/common'

export const portalKinds = ['sourad', 'hospital', 'configuracoes'] as const
export type PortalKind = (typeof portalKinds)[number]
export const portalDeniedMessage = 'Seu usuário não possui acesso a este portal. Solicite autorização à Gestão.'

export const parsePortalKind = (value?: string): PortalKind | undefined => {
  if (!value) return undefined
  if (!portalKinds.includes(value as PortalKind)) throw new BadRequestException('Portal inválido.')
  return value as PortalKind
}

export const assertPortalAccess = (allowed: readonly PortalKind[], portal?: PortalKind) => {
  if (portal && !allowed.includes(portal)) throw new ForbiddenException(portalDeniedMessage)
}

// Used only when an older client omits the new selection during creation.
// Explicit selections are never inferred again when a role changes.
export const defaultRolePortals = (code: string, permissions: readonly string[]): PortalKind[] => {
  if (['DOCTOR', 'SENIOR_DOCTOR'].includes(code)) return ['sourad']
  return portalKinds.filter(portal => {
    if (portal === 'sourad') return permissions.some(p => ['exams.view', 'reports.view', 'patients.view'].includes(p))
    if (portal === 'hospital') return permissions.some(p => p.startsWith('hospital.') && p.endsWith('.view'))
    return permissions.some(p => ['users.create', 'memberships.manage', 'physicians.create', 'units.create', 'roles.create', 'roles.manage', 'companies.manage', 'company.settings.manage', 'exam.catalog.manage'].includes(p))
  })
}
