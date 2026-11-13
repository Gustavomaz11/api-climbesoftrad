import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import { CompanyMembershipEntity } from '../../database/entities/company-membership.entity'
import type { CompanyAccessContext } from './company-context.contracts'

@Injectable()
export class CompanyMembershipReader {
  constructor(private readonly database: DataSource) {}

  query(context: CompanyAccessContext, manager: EntityManager = this.database.manager) {
    const query = manager
      .getRepository(CompanyMembershipEntity)
      .createQueryBuilder('membership')
      .leftJoinAndSelect('membership.user', 'user')
      .leftJoinAndSelect('membership.accessRole', 'accessRole')
      .leftJoinAndSelect('membership.unitLinks', 'unitLink')
      .leftJoinAndSelect('unitLink.unit', 'unit')
      .where('membership.company_id = :companyId', { companyId: context.companyId })
    if (!context.allUnits) {
      query.andWhere(
        `(membership.all_units OR EXISTS (
        SELECT 1 FROM company_membership_units visible
        WHERE visible.membership_id = membership.id AND visible.active
          AND visible.unit_id IN (:...unitIds)
      ))`,
        {
          unitIds: context.unitIds.length
            ? context.unitIds
            : ['00000000-0000-4000-8000-000000000000'],
        },
      )
    }
    return query
  }

  async list(context: CompanyAccessContext) {
    const memberships = await this.query(context).orderBy('user.full_name', 'ASC').getMany()
    return memberships.map((membership) => this.response(membership, context))
  }

  async get(
    id: string,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    const membership = await this.query(context, manager)
      .andWhere('membership.id = :id', { id })
      .getOne()
    if (!membership) throw new NotFoundException('Vínculo não encontrado.')
    return membership
  }

  async forUser(
    userId: string,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    const membership = await this.query(context, manager)
      .andWhere('membership.user_id = :userId', { userId })
      .getOne()
    if (!membership) throw new NotFoundException('Usuário não encontrado nesta empresa.')
    return membership
  }

  assertManage(membership: CompanyMembershipEntity, context: CompanyAccessContext) {
    if (membership.user.role === 'ADMIN') {
      throw new ForbiddenException(
        'A administração da plataforma é gerenciada pela identidade global, não por vínculos locais.',
      )
    }
    if (context.allUnits) return
    if (
      membership.allUnits ||
      membership.unitLinks.some((link) => link.active && !context.unitIds.includes(link.unitId))
    ) {
      throw new ForbiddenException(
        'Selecione todas as unidades autorizadas para administrar este vínculo.',
      )
    }
  }

  response(membership: CompanyMembershipEntity, context: CompanyAccessContext) {
    const links = membership.unitLinks.filter(
      (link) => context.allUnits || context.unitIds.includes(link.unitId),
    )
    return {
      id: membership.id,
      userId: membership.userId,
      companyId: membership.companyId,
      fullName: membership.user.fullName,
      email: membership.user.email,
      username: membership.user.username,
      role: membership.user.role,
      status: membership.active && membership.user.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED',
      canManage:
        membership.user.role !== 'ADMIN' &&
        (context.allUnits ||
          (!membership.allUnits &&
            membership.unitLinks.every(
              (link) => !link.active || context.unitIds.includes(link.unitId),
            ))),
      active:
        membership.active && membership.user.status === 'ACTIVE' && membership.accessRole.active,
      allUnits: membership.allUnits,
      allowedPortals: membership.allowedPortals,
      unitIds: links.filter((link) => link.active).map((link) => link.unitId),
      units: links.map((link) => ({
        id: link.unitId,
        name: link.unit.name,
        active: link.active && link.unit.active,
      })),
      signatureText: membership.signatureText,
      preferencesVersion: membership.preferencesVersion,
      accessRole: {
        id: membership.accessRole.id,
        code: membership.accessRole.code,
        name: membership.accessRole.name,
        active: membership.accessRole.active,
      },
    }
  }
}
