import type { CompanyAccessContext } from '../src/modules/companies/company-context.contracts'
import { defaultRolePermissions } from '../src/modules/access-control/permission.catalog'

export const companyTestContext: CompanyAccessContext = {
  userId: '17dba5fb-2bde-4745-a9c5-cb72deccf8f1',
  sessionId: '80714872-a721-4d8d-8942-b7344fdb1fc6',
  correlationId: '340b52cf-af99-46d0-b79a-e894d9c05b79',
  role: 'DOCTOR',
  isPlatformAdmin: false,
  mustChangePassword: false,
  companyId: '00000000-0000-4000-8000-000000000001',
  companyName: 'Sourad',
  membershipId: 'a4e7a7a5-51e3-486d-bb25-cb6a28059bd0',
  allUnits: true,
  unitIds: ['6d6539a7-1f1c-4850-9ef7-95dc3812d011'],
  selectedUnitId: null,
  accessRoleId: 'b6021588-c3d4-4660-b852-a10b11691616',
  accessRoleName: 'Médico',
  permissions: [...defaultRolePermissions.DOCTOR!],
}
