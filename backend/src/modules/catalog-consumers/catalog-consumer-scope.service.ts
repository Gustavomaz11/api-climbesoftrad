import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import { ExamTypeEntity } from '../../database/entities/exam-type.entity'
import { PhysicianEntity } from '../../database/entities/physician.entity'
import { CompanyMembershipReader } from '../companies/company-membership-reader'
import { CompanyScopeService } from '../companies/company-scope.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
@Injectable()
export class CatalogConsumerScopeService {
  constructor(
    private readonly database: DataSource,
    private readonly companies: CompanyScopeService,
    private readonly memberships: CompanyMembershipReader,
  ) {}
  async type(
    id: string,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    const type = await manager
      .getRepository(ExamTypeEntity)
      .findOne({
        where: { id, companyId: context.companyId, active: true },
        ...(manager.queryRunner?.isTransactionActive
          ? { lock: { mode: 'pessimistic_read' as const } }
          : {}),
      })
    if (!type) throw new NotFoundException('Tipo de exame ativo não encontrado.')
    return type
  }
  async unit(unitId: string | null | undefined, context: CompanyAccessContext) {
    if (!unitId) {
      if (!context.allUnits)
        throw new ForbiddenException(
          'Selecione todas as unidades para manter uma regra geral da empresa.',
        )
      return null
    }
    const unit = await this.companies.requireUnit(unitId, context)
    if (!unit.active) throw new BadRequestException('Unidade inativa.')
    return unit.id
  }
  async physician(
    id: string,
    unitId: string | null,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    const physician = await manager.getRepository(PhysicianEntity).findOneBy({ id })
    if (!physician) throw new NotFoundException('Médico não encontrado.')
    const membership = await this.memberships.forUser(physician.userId, context, manager)
    if (
      !membership.active ||
      membership.user.status !== 'ACTIVE' ||
      !membership.accessRole.active ||
      (!membership.allUnits &&
        (!unitId || !membership.unitLinks.some((link) => link.active && link.unitId === unitId)))
    )
      throw new BadRequestException('Médico sem vínculo ativo no escopo da regra.')
    return physician
  }
}
