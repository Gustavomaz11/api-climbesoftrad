import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource } from 'typeorm'
import { CompanyEntity } from '../../database/entities/company.entity'
import type { AuthenticatedRequestData } from '../auth/auth.contracts'
import type { CompanyAccessContext } from './company-context.contracts'
import { CompanyScopeService } from './company-scope.service'
import { seedCompanyRoles } from './company-default-roles'
import { OperationalAuditService } from './operational-audit.service'

@Injectable()
export class CompaniesService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: CompanyScopeService,
    private readonly audit: OperationalAuditService,
  ) {}

  async list(auth: AuthenticatedRequestData) {
    if (auth.isPlatformAdmin) {
      return this.database.getRepository(CompanyEntity).find({ order: { name: 'ASC' } })
    }
    return (await this.scope.available(auth.userId, false)).map((company) => ({
      id: company.id,
      name: company.name,
      active: true,
    }))
  }

  async create(name: string, auth: AuthenticatedRequestData) {
    try {
      return await this.database.transaction(async (manager) => {
        const repository = manager.getRepository(CompanyEntity)
        const company = await repository.save(
          repository.create({ name: name.trim().replace(/\s+/g, ' ') }),
        )
        await seedCompanyRoles(manager, company.id)
        await this.audit.record(
          { ...auth, companyId: company.id },
          {
            action: 'COMPANY_CREATED',
            resourceType: 'company',
            resourceId: company.id,
          },
          manager,
        )
        return company
      })
    } catch (error: unknown) {
      this.rethrowConflict(error)
    }
  }

  async update(id: string, name: string, context: CompanyAccessContext) {
    if (id !== context.companyId) throw new NotFoundException('Empresa não encontrada.')
    if (!context.allUnits)
      throw new ForbiddenException('Selecione todas as unidades para administrar a empresa.')
    try {
      return await this.database.transaction(async (manager) => {
        const companies = manager.getRepository(CompanyEntity)
        const company = await companies.findOneByOrFail({ id })
        company.name = name.trim().replace(/\s+/g, ' ')
        await companies.save(company)
        await this.audit.record(
          context,
          {
            action: 'COMPANY_UPDATED',
            resourceType: 'company',
            resourceId: id,
          },
          manager,
        )
        return company
      })
    } catch (error: unknown) {
      this.rethrowConflict(error)
    }
  }

  async setActive(
    id: string,
    active: boolean,
    reason: string | undefined,
    auth: AuthenticatedRequestData,
  ) {
    return this.database.transaction(async (manager) => {
      const repository = manager.getRepository(CompanyEntity)
      const company = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      })
      if (!company) throw new NotFoundException('Empresa não encontrada.')
      if (company.active === active) return company
      company.active = active
      await repository.save(company)
      await this.audit.record(
        { ...auth, companyId: id },
        {
          action: 'COMPANY_UPDATED',
          resourceType: 'company',
          resourceId: id,
          reason: reason?.trim(),
          metadata: { active },
        },
        manager,
      )
      return company
    })
  }

  private rethrowConflict(error: unknown): never {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new ConflictException('Já existe uma empresa com este nome.')
    }
    throw error
  }
}
