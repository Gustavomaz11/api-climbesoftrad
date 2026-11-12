import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { normalizeCnpj, validCnpj } from './cnpj.policy'

@Injectable()
export class CnpjaService {
  constructor(private readonly config: ConfigService) {}
  async lookup(input: string) {
    if (!validCnpj(input)) throw new BadRequestException('CNPJ inválido. Confira os dígitos verificadores.')
    const cnpj = normalizeCnpj(input), token = this.config.get<string>('CNPJA')
    if (!token) throw new ServiceUnavailableException('Consulta de CNPJ não configurada.')
    let response: Response
    try { response = await fetch(`https://api.cnpja.com/office/${cnpj}`, { headers: { Authorization: token, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) }) }
    catch { throw new ServiceUnavailableException('Consulta de CNPJ indisponível. Tente novamente.') }
    if (response.status === 404) throw new NotFoundException('CNPJ não encontrado.')
    if (!response.ok) throw new ServiceUnavailableException('Não foi possível consultar o CNPJ no momento.')
    let raw: unknown
    try { raw = await response.json() }
    catch { throw new ServiceUnavailableException('Resposta da consulta inconsistente. Tente novamente.') }
    const data = raw as { taxId?: string; company?: { name?: string }; alias?: string; address?: Record<string, string>; phones?: Array<{ area?: string; number?: string }>; emails?: Array<{ address?: string }> }
    if (normalizeCnpj(data?.taxId ?? '') !== cnpj || !data.company?.name || !data.address)
      throw new ServiceUnavailableException('Resposta da consulta inconsistente. Confira o CNPJ.')
    const value = (input: unknown, max: number) => typeof input === 'string' ? input.trim().slice(0, max) : ''
    return { cnpj, legalName: value(data.company.name, 160), tradeName: value(data.alias, 160),
      uf: value(data.address.state, 2), address: { zipCode: value(data.address.zip, 8), street: value(data.address.street, 160),
        number: value(data.address.number, 30), neighborhood: value(data.address.district, 120), city: value(data.address.city, 120) },
      contactPhone: value((data.phones?.[0]?.area ?? '') + (data.phones?.[0]?.number ?? ''), 30), contactEmail: value(data.emails?.[0]?.address, 254) }
  }
}
