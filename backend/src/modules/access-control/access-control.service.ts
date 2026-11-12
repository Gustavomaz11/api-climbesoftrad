import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { DataSource, In, type EntityManager } from 'typeorm'
import { AccessPermissionEntity } from '../../database/entities/access-permission.entity'
import { CompanyMembershipEntity } from '../../database/entities/company-membership.entity'
import { AccessRoleEntity } from '../../database/entities/access-role.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { assertPermissionGrant } from '../companies/company-access-policy'
import { CompanyMembershipReader } from '../companies/company-membership-reader'
import { CompanyMembershipService } from '../companies/company-membership.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { AssignUserRoleDto } from './dto/assign-user-role.dto'
import type { CreateAccessRoleDto } from './dto/create-access-role.dto'
import type { UpdateAccessRoleDto } from './dto/update-access-role.dto'

@Injectable()
export class AccessControlService {
  constructor(
    private readonly database: DataSource,
    private readonly reader: CompanyMembershipReader,
    private readonly memberships: CompanyMembershipService,
    private readonly audit: OperationalAuditService,
  ) {}

  listPermissions() {
    return this.database
      .getRepository(AccessPermissionEntity)
      .find({ order: { group: 'ASC', name: 'ASC' } })
  }

  async listRoles(context: CompanyAccessContext) {
    const roles = await this.database.getRepository(AccessRoleEntity).find({
      where: { companyId: context.companyId },
      relations: { permissions: true },
      order: { immutable: 'DESC', name: 'ASC' },
    })
    return Promise.all(
      roles.map(async (role) =>
        this.response(
          role,
          await this.reader
            .query(context)
            .andWhere('membership.access_role_id = :roleId', { roleId: role.id })
            .getCount(),
        ),
      ),
    )
  }

  async createRole(dto: CreateAccessRoleDto, context: CompanyAccessContext) {
    return this.mutate(async (manager) => {
      const repository = manager.getRepository(AccessRoleEntity)
      const role = await repository.save(
        repository.create({
          companyId: context.companyId,
          code: 'CUSTOM_' + randomUUID().replaceAll('-', '').toUpperCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          active: true,
          immutable: false,
          permissions: await this.permissions(dto.permissionCodes, context, manager),
        }),
      )
      await this.audit.record(
        context,
        { action: 'ROLE_CREATED', resourceType: 'role', resourceId: role.id },
        manager,
      )
      return this.response(role, 0)
    })
  }

  async updateRole(id: string, dto: UpdateAccessRoleDto, context: CompanyAccessContext) {
    return this.mutate(async (manager) => {
      const repository = manager.getRepository(AccessRoleEntity)
      const role = await this.editableRole(id, context, manager)
      assertPermissionGrant(
        context.permissions,
        role.permissions.map((permission) => permission.code),
      )
      role.name = dto.name.trim()
      role.description = dto.description?.trim() || null
      role.permissions = await this.permissions(dto.permissionCodes, context, manager)
      await repository.save(role)
      if (!role.permissions.some((permission) => permission.code === 'reports.edit'))
        await this.clearRolePresence(id, context, manager)
      await this.audit.record(
        context,
        { action: 'ROLE_UPDATED', resourceType: 'role', resourceId: role.id },
        manager,
      )
      const count = await this.reader
        .query(context, manager)
        .andWhere('membership.access_role_id = :roleId', { roleId: id })
        .getCount()
      return this.response(role, count)
    })
  }

  async setRoleActive(id: string, active: boolean, context: CompanyAccessContext) {
    return this.mutate(async (manager) => {
      const role = await this.editableRole(id, context, manager)
      assertPermissionGrant(
        context.permissions,
        role.permissions.map((permission) => permission.code),
      )
      if (role.active !== active) {
        role.active = active
        await manager.getRepository(AccessRoleEntity).save(role)
        if (!active) await this.clearRolePresence(id, context, manager)
        await this.audit.record(
          context,
          {
            action: 'ROLE_STATUS_CHANGED',
            resourceType: 'role',
            resourceId: id,
            metadata: { active },
          },
          manager,
        )
      }
      const count = await this.reader
        .query(context, manager)
        .andWhere('membership.access_role_id = :roleId', { roleId: id })
        .getCount()
      return this.response(role, count)
    })
  }

  async listUsers(context: CompanyAccessContext) {
    return (await this.reader.list(context)).map((membership) => ({
      ...membership,
      membershipId: membership.id,
      id: membership.userId,
    }))
  }

  assignUserRole(userId: string, dto: AssignUserRoleDto, context: CompanyAccessContext) {
    return this.memberships.assignRole(userId, dto.roleId, context)
  }

  private async permissions(
    codes: string[],
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    assertPermissionGrant(context.permissions, codes)
    const unique = [...new Set(codes)]
    const permissions = unique.length
      ? await manager.getRepository(AccessPermissionEntity).findBy({ code: In(unique) })
      : []
    if (permissions.length !== unique.length) throw new BadRequestException('Permissões inválidas.')
    return permissions
  }

  private async editableRole(id: string, context: CompanyAccessContext, manager: EntityManager) {
    const role = await manager.getRepository(AccessRoleEntity).findOne({
      where: { id, companyId: context.companyId },
      relations: { permissions: true },
    })
    if (!role) throw new NotFoundException('Cargo não encontrado.')
    if (!context.allUnits) {
      const outside = await manager
        .getRepository(CompanyMembershipEntity)
        .createQueryBuilder('member')
        .where('member.company_id = :companyId AND member.access_role_id = :roleId', {
          companyId: context.companyId,
          roleId: id,
        })
        .andWhere(
          `(member.all_units OR EXISTS (SELECT 1 FROM company_membership_units links
          WHERE links.membership_id = member.id AND links.active AND NOT (links.unit_id = ANY(:unitIds::uuid[]))))`,
          { unitIds: context.unitIds },
        )
        .getExists()
      if (outside)
        throw new ForbiddenException(
          'Este cargo também administra vínculos fora das suas unidades.',
        )
    }
    if (role.immutable)
      throw new ForbiddenException('O cargo de administrador desta empresa é permanente.')
    return role
  }

  private clearRolePresence(roleId: string, context: CompanyAccessContext, manager: EntityManager) {
    return manager.query(
      `DELETE FROM exam_report_presences presence USING exams exam, company_memberships member
      WHERE presence.exam_id = exam.id AND exam.company_id = $1
        AND member.company_id = $1 AND member.access_role_id = $2 AND member.user_id = presence.user_id`,
      [context.companyId, roleId],
    )
  }

  private async mutate<T>(operation: (manager: EntityManager) => Promise<T>) {
    try {
      return await this.database.transaction(operation)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new ConflictException('Já existe um cargo com este nome nesta empresa.')
      }
      throw error
    }
  }

  private response(role: AccessRoleEntity, userCount: number) {
    return {
      id: role.id,
      companyId: role.companyId,
      code: role.code,
      name: role.name,
      description: role.description,
      active: role.active,
      immutable: role.immutable,
      userCount,
      permissions: [...role.permissions].sort((left, right) => left.code.localeCompare(right.code)),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }
  }
}
