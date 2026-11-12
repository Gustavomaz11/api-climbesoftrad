import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource, IsNull } from 'typeorm'
import { CompanySettingsRevisionEntity } from '../../database/entities/company-settings-revision.entity'
import { CompanyMembershipEntity } from '../../database/entities/company-membership.entity'
import type { CompanyAccessContext } from './company-context.contracts'
import { CompanyScopeService } from './company-scope.service'
import { resolvePresentation, type DocumentPresentation } from './company-presentation'
import { OperationalAuditService } from './operational-audit.service'
import type { SaveCompanySettingsDto } from './dto/company.dto'

@Injectable()
export class CompanyPresentationService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: CompanyScopeService,
    private readonly audit: OperationalAuditService,
  ) {}

  async current(companyId: string, unitId: string | null, userId: string) {
    const revisions = this.database.getRepository(CompanySettingsRevisionEntity)
    const [company, unit, membership] = await Promise.all([
      revisions.findOne({ where: { companyId, unitId: IsNull() }, order: { version: 'DESC' } }),
      unitId
        ? revisions.findOne({ where: { companyId, unitId }, order: { version: 'DESC' } })
        : Promise.resolve(null),
      this.database
        .getRepository(CompanyMembershipEntity)
        .findOneBy({ companyId, userId, active: true }),
    ])
    return {
      company: { version: company?.version ?? 0, presentation: company?.presentation ?? {} },
      unit: { version: unit?.version ?? 0, presentation: unit?.presentation ?? {} },
      effective: resolvePresentation(
        company?.presentation ?? {},
        unit?.presentation ?? {},
        membership?.signatureText ?? null,
      ),
    }
  }

  async get(context: CompanyAccessContext, unitId?: string) {
    if (unitId) await this.scope.requireUnit(unitId, context)
    return this.current(context.companyId, unitId ?? null, context.userId)
  }

  async save(dto: SaveCompanySettingsDto, context: CompanyAccessContext) {
    if (dto.unitId) await this.scope.requireUnit(dto.unitId, context)
    if (!dto.unitId && !context.allUnits) {
      throw new ConflictException(
        'Selecione todas as unidades para alterar configurações da empresa.',
      )
    }
    await this.database.transaction(async (manager) => {
      const key = context.companyId + ':' + (dto.unitId ?? 'company')
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key])
      const repository = manager.getRepository(CompanySettingsRevisionEntity)
      const previous = await repository.findOne({
        where: { companyId: context.companyId, unitId: dto.unitId ?? IsNull() },
        order: { version: 'DESC' },
      })
      const version = previous?.version ?? 0
      if (version !== dto.expectedVersion)
        throw new ConflictException('Configuração alterada por outro usuário. Recarregue.')
      const presentation: Partial<DocumentPresentation> = {}
      for (const field of ['headerText', 'footerText', 'signatureText'] as const) {
        if (typeof dto.presentation[field] === 'string')
          presentation[field] = dto.presentation[field].trim()
      }
      const revision = await repository.save(
        repository.create({
          companyId: context.companyId,
          unitId: dto.unitId ?? null,
          version: version + 1,
          presentation,
          createdByUserId: context.userId,
        }),
      )
      await this.audit.record(
        context,
        {
          action: 'COMPANY_SETTINGS_CHANGED',
          resourceType: 'settings',
          resourceId: revision.id,
          unitId: dto.unitId,
          metadata: { version: revision.version },
        },
        manager,
      )
    })
    return this.get(context, dto.unitId)
  }
}
