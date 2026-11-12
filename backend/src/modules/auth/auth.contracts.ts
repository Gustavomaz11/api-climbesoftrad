import type { AuthenticatedUserDto } from './dto/authenticated-user.dto'
import type { Request } from 'express'
import type { PermissionCode } from '../access-control/permission.catalog'

export interface RequestMetadata {
  ipAddress: string | null
  userAgent: string | null
}

export interface AuthorizationCodeResult {
  authorizationCode: string
  state: string
  expiresIn: number
}

export interface AccessTokenResult {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
  refreshToken: string
  persistent: boolean
}

export interface AccessTokenClaims {
  iss: string
  aud: string
  sub: string
  sid: string
  jti: string
  iat: number
  exp: number
}

export interface AuthenticatedRequestData {
  isPlatformAdmin: boolean
  correlationId: string
  userId: string
  sessionId: string
  role: 'USER' | 'ADMIN' | 'DOCTOR'
  mustChangePassword: boolean
  accessRoleId: string
  accessRoleName: string
  permissions: PermissionCode[]
}

export interface AuthenticatedRequest extends Request {
  auth: AuthenticatedRequestData
}

export type AuthenticatedUser = AuthenticatedUserDto
