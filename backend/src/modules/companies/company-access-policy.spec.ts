import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { assertPermissionGrant, assertUnitScope } from './company-access-policy'

describe('Company access policy', () => {
  const context = { companyId: 'company-a', allUnits: false, unitIds: ['unit-a'] }

  it('allows an assigned unit in the active company', () => {
    expect(() => assertUnitScope(context, { id: 'unit-a', companyId: 'company-a' })).not.toThrow()
  })

  it('rejects another unit even in the same company', () => {
    expect(() => assertUnitScope(context, { id: 'unit-b', companyId: 'company-a' })).toThrow(
      NotFoundException,
    )
  })

  it('does not let access to all units bypass the active company', () => {
    expect(() =>
      assertUnitScope(
        { ...context, allUnits: true },
        {
          id: 'unit-b',
          companyId: 'company-b',
        },
      ),
    ).toThrow(NotFoundException)
  })

  it('allows a company administrator to grant permissions they hold', () => {
    expect(() =>
      assertPermissionGrant(['users.roles.assign', 'exams.view'], ['exams.view']),
    ).not.toThrow()
  })

  it('rejects privilege escalation through a role or invitation', () => {
    expect(() =>
      assertPermissionGrant(['users.create'], ['users.create', 'roles.permissions.manage']),
    ).toThrow(ForbiddenException)
  })
})
