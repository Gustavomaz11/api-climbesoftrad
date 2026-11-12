import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import { ExamTypeEntity } from '../../database/entities/exam-type.entity'
import { ExamTypeAliasEntity } from '../../database/entities/exam-type-alias.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { CompanyScopeService } from '../companies/company-scope.service'
import { chooseDescriptionMapping, normalizeExamDescription } from './exam-description.policy'
@Injectable()
export class ExamDescriptionResolverService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: CompanyScopeService,
  ) {}
  async requireType(
    id: string,
    modality: string,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    const type = await manager
      .getRepository(ExamTypeEntity)
      .findOneBy({ id, companyId: context.companyId })
    if (!type) throw new NotFoundException('Tipo de exame não encontrado.')
    if (!type.active || type.modality !== modality)
      throw new BadRequestException('Tipo de exame inativo ou incompatível com a modalidade.')
    return type
  }
  async resolve(
    description: string,
    modality: string,
    unitId: string,
    issuer: string | undefined,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
    manualTypeId?: string,
  ) {
    if (manualTypeId) {
      await this.requireType(manualTypeId, modality, context, manager)
      return {
        status: 'APPROVED' as const,
        examTypeId: manualTypeId,
        ruleVersion: null,
        aliasId: null,
      }
    }
    const matches = await manager.getRepository(ExamTypeAliasEntity).find({
      where: {
        companyId: context.companyId,
        normalizedDescription: normalizeExamDescription(description),
        modality,
        active: true,
      },
    })
    const types = await manager
      .getRepository(ExamTypeEntity)
      .findBy({ companyId: context.companyId, active: true, modality })
    return chooseDescriptionMapping(
      matches
        .filter(
          (alias) =>
            (!alias.unitId || alias.unitId === unitId) &&
            (!alias.issuer || alias.issuer === issuer) &&
            types.some((type) => type.id === alias.examTypeId),
        )
        .map((alias) => ({
          id: alias.id,
          examTypeId: alias.examTypeId,
          version: alias.version,
          specificity: (alias.unitId ? 2 : 0) + (alias.issuer ? 1 : 0),
        })),
    )
  }
  async preview(
    input: { description: string; modality: string; unitId: string; issuer?: string },
    context: CompanyAccessContext,
  ) {
    await this.scope.requireUnit(input.unitId, context)
    return this.resolve(input.description, input.modality, input.unitId, input.issuer, context)
  }
}
