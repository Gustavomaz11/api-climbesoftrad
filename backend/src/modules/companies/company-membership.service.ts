import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { CompanyMembershipEntity } from '../../database/entities/company-membership.entity'
import type { CompanyAccessContext } from './company-context.contracts'
import { CompanyMembershipReader } from './company-membership-reader'
import {
  requireMembershipRole,
  saveMembershipUnits,
  validateMembershipUnits,
} from './company-membership-grants'
import { clearCompanyReportPresence } from './revoke-report-presence'
import { OperationalAuditService } from './operational-audit.service'
import type { MembershipPreferencesDto, MembershipUnitsDto } from './dto/membership.dto'

@Injectable()
export class CompanyMembershipService {
  constructor(
    private readonly database: DataSource,
    private readonly reader: CompanyMembershipReader,
    private readonly audit: OperationalAuditService,
  ) {}

  async setActive(id: string, active: boolean, context: CompanyAccessContext, reason?: string) {
    return this.database.transaction(async (manager) => {
      const membership = await this.reader.get(id, context, manager)
      this.reader.assertManage(membership, context)
      const repository = manager.getRepository(CompanyMembershipEntity)
      const locked = await repository.findOneOrFail({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      })
      membership.active = locked.active
      if (membership.active === active) return this.reader.response(membership, context)
      membership.active = active
      await repository.save(membership)
      if (!active) await clearCompanyReportPresence(manager, context.companyId, membership.userId)
      await this.audit.record(
        context,
        {
          action: active ? 'MEMBERSHIP_REACTIVATED' : 'MEMBERSHIP_REVOKED',
          resourceType: 'membership',
          resourceId: id,
          reason: reason?.trim(),
        },
        manager,
      )
      return this.reader.response(membership, context)
    })
  }

  async units(id: string, dto: MembershipUnitsDto, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      const membership = await this.reader.get(id, context, manager)
      this.reader.assertManage(membership, context)
      const unitIds = await validateMembershipUnits(manager, dto, context)
      await manager.getRepository(CompanyMembershipEntity).update(id, { allUnits: dto.allUnits })
      await saveMembershipUnits(manager, id, context.companyId, dto.allUnits ? [] : unitIds)
      if (!dto.allUnits)
        await clearCompanyReportPresence(manager, context.companyId, membership.userId, unitIds)
      await this.audit.record(
        context,
        {
          action: 'MEMBERSHIP_UPDATED',
          resourceType: 'membership',
          resourceId: id,
          reason: dto.reason?.trim(),
          metadata: { allUnits: dto.allUnits, unitCount: unitIds.length },
        },
        manager,
      )
      const updated = await manager.getRepository(CompanyMembershipEntity).findOneOrFail({
        where: { id, companyId: context.companyId },
        relations: { user: true, accessRole: true, unitLinks: { unit: true } },
      })
      return this.reader.response(updated, context)
    })
  }

  async assignRole(userId: string, roleId: string, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      const membership = await this.reader.forUser(userId, context, manager)
      this.reader.assertManage(membership, context)
      const role = await requireMembershipRole(manager, roleId, context)
      if (membership.accessRoleId !== role.id) {
        await manager
          .getRepository(CompanyMembershipEntity)
          .update(membership.id, { accessRoleId: role.id })
        if (!role.permissions.some((permission) => permission.code === 'reports.edit')) {
          await clearCompanyReportPresence(manager, context.companyId, membership.userId)
        }
        await this.audit.record(
          context,
          {
            action: 'ROLE_ASSIGNED',
            resourceType: 'membership',
            resourceId: membership.id,
            metadata: { roleId: role.id },
          },
          manager,
        )
      }
      return {
        id: userId,
        fullName: membership.user.fullName,
        accessRole: { id: role.id, code: role.code, name: role.name, active: role.active },
      }
    })
  }

  async preferences(id: string, dto: MembershipPreferencesDto, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      const membership = await this.reader.get(id, context, manager)
      if (membership.userId !== context.userId) {
        if (!context.permissions.includes('memberships.manage')) {
          throw new ConflictException('Você pode alterar apenas suas preferências nesta empresa.')
        }
        this.reader.assertManage(membership, context)
      }
      const repository = manager.getRepository(CompanyMembershipEntity)
      const locked = await repository.findOneOrFail({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      })
      if (locked.preferencesVersion !== dto.expectedVersion)
        throw new ConflictException('Preferências alteradas. Recarregue.')
      locked.signatureText = dto.signatureText?.trim() || null
      locked.preferencesVersion += 1
      await repository.save(locked)
      await this.audit.record(
        context,
        {
          action: 'MEMBERSHIP_PREFERENCES_CHANGED',
          resourceType: 'membership',
          resourceId: id,
          metadata: { version: locked.preferencesVersion },
        },
        manager,
      )
      return { signatureText: locked.signatureText, preferencesVersion: locked.preferencesVersion }
    })
  }
}
