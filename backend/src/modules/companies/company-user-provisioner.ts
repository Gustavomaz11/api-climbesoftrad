import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { CompanyMembershipEntity } from '../../database/entities/company-membership.entity'
import { CryptoService } from '../auth/crypto.service'
import type { CompanyAccessContext } from './company-context.contracts'
import {
  requireMembershipRole,
  saveMembershipUnits,
  validateMembershipUnits,
} from './company-membership-grants'
import { OperationalAuditService } from './operational-audit.service'
import type { ProvisionCompanyUserDto } from './dto/membership.dto'

@Injectable()
export class CompanyUserProvisioner {
  constructor(
    private readonly database: DataSource,
    private readonly crypto: CryptoService,
    private readonly audit: OperationalAuditService,
  ) {}

  async provision(dto: ProvisionCompanyUserDto, context: CompanyAccessContext) {
    const initialPassword = this.crypto.createOpaqueToken(18)
    const passwordHash = await this.crypto.hashPassword(initialPassword)
    try {
      return await this.database.transaction(async (manager) => {
        const role = await requireMembershipRole(manager, dto.roleId, context)
        const unitIds = await validateMembershipUnits(manager, dto, context)
        const users = manager.getRepository(AuthUserEntity)
        let user = await users.findOneBy({ email: dto.email.trim().toLowerCase() })
        const existing = Boolean(user)
        if (user?.role === 'ADMIN' && !context.isPlatformAdmin) {
          throw new ForbiddenException(
            'A administração local não pode vincular uma identidade da plataforma.',
          )
        }
        if (user) {
          const membership = await manager.getRepository(CompanyMembershipEntity).existsBy({
            userId: user.id,
            companyId: context.companyId,
          })
          if (membership)
            throw new ConflictException('Usuário já vinculado. Gerencie o vínculo existente.')
        } else {
          user = await users.save(
            users.create({
              email: dto.email.trim().toLowerCase(),
              fullName: dto.fullName.trim().replace(/\s+/g, ' '),
              passwordHash,
              status: 'ACTIVE',
              role: 'USER',
              accessRoleId: role.id,
              mustChangePassword: true,
            }),
          )
        }
        const memberships = manager.getRepository(CompanyMembershipEntity)
        const membership = await memberships.save(
          memberships.create({
            companyId: context.companyId,
            userId: user.id,
            accessRoleId: role.id,
            active: true,
            allUnits: dto.allUnits,
          }),
        )
        await saveMembershipUnits(
          manager,
          membership.id,
          context.companyId,
          dto.allUnits ? [] : unitIds,
        )
        await this.audit.record(
          context,
          {
            action: 'MEMBERSHIP_CREATED',
            resourceType: 'membership',
            resourceId: membership.id,
            metadata: {
              existingIdentity: existing,
              roleId: role.id,
              unitCount: unitIds.length,
              allUnits: dto.allUnits,
            },
          },
          manager,
        )
        return {
          id: membership.id,
          userId: user.id,
          existingIdentity: existing,
          initialPassword: existing ? null : initialPassword,
          mustChangePassword: user.mustChangePassword,
        }
      })
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new ConflictException(
          'Usuário já cadastrado ou vinculado. Recarregue e tente novamente.',
        )
      }
      throw error
    }
  }
}
