import { SetMetadata } from '@nestjs/common'
import type { PermissionCode } from '../access-control/permission.catalog'

export const REQUIRED_PERMISSIONS_KEY = 'required-permissions'

export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions)
