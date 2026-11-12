import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource, type EntityManager } from 'typeorm'
import { IsIn, IsString, Matches } from 'class-validator'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { brazilStates, normalizeRegistryDoctor, type PhysicianRegistryProfile } from './physician-registry.policy'

export class RegistryLookupDto {
  @IsString() @Matches(/^\d{1,10}$/) crm: string
  @IsIn(brazilStates) uf: string
}

@Injectable()
export class PhysicianRegistryService {
  constructor(private readonly config: ConfigService, private readonly database: DataSource) {}

  async lookup(dto: RegistryLookupDto, context: CompanyAccessContext) {
    const token = this.config.get<string>('DIRECTD_CFM_TOKEN')
    if (!token) throw new ServiceUnavailableException('Consulta de CRM não configurada.')
    const url = new URL(this.config.getOrThrow<string>('DIRECTD_CFM_URL'))
    url.searchParams.set('CRM', dto.crm); url.searchParams.set('UF', dto.uf); url.searchParams.set('TOKEN', token)
    let profile: PhysicianRegistryProfile
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' })
      if (!response.ok) throw new Error('Registry transport error')
      const data = await response.json() as { metaDados?: { resultadoId?: number }; retorno?: { medicos?: Array<Record<string, unknown>> } }
      const doctors = data.retorno?.medicos
      if (data.metaDados?.resultadoId !== 1 || !Array.isArray(doctors)) throw new Error('Registry provider error')
      if (doctors.length === 0) throw new BadRequestException('Nenhum médico encontrado para este CRM e UF.')
      if (doctors.length !== 1) throw new BadRequestException('A consulta retornou mais de um médico. Confira o CRM e a UF.')
      profile = normalizeRegistryDoctor(doctors[0]!, dto.crm, dto.uf)
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      // Provider bodies, metadata and URLs can contain the token: never log/return them.
      throw new BadGatewayException('Não foi possível consultar o CRM. Aguarde e tente novamente.')
    }
    await this.database.query('DELETE FROM physician_registry_lookups WHERE expires_at<now()')
    const [record] = await this.database.query<Array<{ id: string }>>(
      `INSERT INTO physician_registry_lookups(company_id,user_id,profile) VALUES($1,$2,$3::jsonb) RETURNING id`,
      [context.companyId, context.userId, JSON.stringify(profile)],
    )
    return { lookupId: record!.id, ...profile, enabledStates: profile.registrations.filter(item => item.enabled).map(item => item.uf) }
  }

  async consume(id: string, context: CompanyAccessContext, manager: EntityManager) {
    const [record] = await manager.query<Array<{ profile: PhysicianRegistryProfile }>>(
      `SELECT profile FROM physician_registry_lookups WHERE id=$1 AND company_id=$2 AND user_id=$3
       AND expires_at>now() AND consumed_at IS NULL FOR UPDATE`, [id, context.companyId, context.userId],
    )
    if (!record) throw new BadRequestException('Consulta de CRM expirada ou indisponível. Consulte novamente.')
    await manager.query('UPDATE physician_registry_lookups SET consumed_at=now() WHERE id=$1', [id])
    return record.profile
  }
}
