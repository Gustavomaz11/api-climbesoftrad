import type { PortalKind } from './portal-access'
import type { AuthenticatedRequest, AuthenticatedRequestData } from '../auth/auth.contracts'

export interface CompanyAccessContext extends AuthenticatedRequestData {
  allowedPortals?: PortalKind[]
  integrationSourceId?: string
  companyId: string
  companyName: string
  membershipId: string | null
  allUnits: boolean
  unitIds: string[]
  selectedUnitId: string | null
}

export interface CompanyAuthenticatedRequest extends AuthenticatedRequest {
  auth: CompanyAccessContext
}

export interface CompanyAccessSummary {
  allowedPortals: PortalKind[]
  id: string
  name: string
  membershipId: string | null
  accessRole: { id: string; code: string; name: string }
  allUnits: boolean
  units: Array<{ id: string; name: string; active: boolean }>
}
