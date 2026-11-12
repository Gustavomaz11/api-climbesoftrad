import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { IsString, IsUUID, Matches } from 'class-validator'
import { DataSource } from 'typeorm'
import { RouterCryptoService } from './router-crypto.service'

export class ActivateRouterDto {
  @IsUUID() ticketId: string
  @IsUUID() deviceId: string
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) activationCode: string
}
interface Ticket { id: string; unit_id: string; company_id: string; created_by_user_id: string; expires_at: Date; installation_id: string | null }
@Injectable()
export class RouterActivationService {
  constructor(private readonly db: DataSource, private readonly crypto: RouterCryptoService) {}
  async activate(dto: ActivateRouterDto) {
    return this.db.transaction(async manager => {
      const [ticket] = await manager.query<Ticket[]>('SELECT * FROM router_installer_tickets WHERE id=$1 AND code_hash=$2 FOR UPDATE',
        [dto.ticketId, createHash('sha256').update(dto.activationCode).digest('hex')])
      if (!ticket) throw new UnauthorizedException('Instalador inválido. Baixe o Router novamente na Gestão.')
      const [unit] = await manager.query<Array<{ name: string; cnpj: string | null; internal_identifier: string | null; active: boolean }>>(
        'SELECT name,cnpj,internal_identifier,active FROM hospital_units WHERE id=$1 AND company_id=$2', [ticket.unit_id, ticket.company_id])
      if (!unit?.active) throw new ForbiddenException('Unidade indisponível.')
      if (ticket.expires_at < new Date()) throw new UnauthorizedException('Instalador expirado. Baixe o Router novamente.')
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['router:' + ticket.unit_id + ':' + dto.deviceId])
      let [installation] = await manager.query<Array<{ id: string; device_id: string; source_id: string; encrypted_token: string }>>(
        'SELECT * FROM router_installations WHERE unit_id=$1 AND device_id=$2 FOR UPDATE', [ticket.unit_id, dto.deviceId])
      if (ticket.installation_id) {
        if (!installation || installation.id !== ticket.installation_id) throw new UnauthorizedException('Este instalador já foi utilizado. Baixe outro para a unidade.')
      } else {
        const token = randomBytes(32).toString('base64url'), tokenHash = createHash('sha256').update(token).digest('hex')
        if (installation) {
          await manager.query('UPDATE dicom_sources SET token_hash=$2,active=true,last_seen_at=NULL,requires_tls=true WHERE id=$1', [installation.source_id, tokenHash])
          installation.encrypted_token = this.crypto.seal(token)
          await manager.query('UPDATE router_installations SET encrypted_token=$2 WHERE id=$1', [installation.id, installation.encrypted_token])
        } else {
          const sourceId = randomUUID(), installationId = randomUUID(), sealed = this.crypto.seal(token)
          await manager.query(`INSERT INTO dicom_sources(id,company_id,unit_id,name,token_hash,created_by_user_id,requires_tls)
            VALUES($1,$2,$3,$4,$5,$6,true)`, [sourceId, ticket.company_id, ticket.unit_id, 'Router ' + (unit.internal_identifier || unit.name).slice(0, 100), tokenHash, ticket.created_by_user_id])
          await manager.query('INSERT INTO router_installations(id,company_id,unit_id,device_id,source_id,encrypted_token) VALUES($1,$2,$3,$4,$5,$6)',
            [installationId, ticket.company_id, ticket.unit_id, dto.deviceId, sourceId, sealed])
          installation = { id: installationId, source_id: sourceId, device_id: dto.deviceId, encrypted_token: sealed }
        }
        await manager.query('UPDATE router_installer_tickets SET installation_id=$2 WHERE id=$1', [ticket.id, installation.id])
      }
      const [source] = await manager.query<Array<{ active: boolean }>>('SELECT active FROM dicom_sources WHERE id=$1', [installation.source_id])
      if (!source?.active) throw new UnauthorizedException('Router revogado. Baixe um novo instalador.')
      return { installationId: installation.id, unitId: ticket.unit_id, unitName: unit.name, cnpj: unit.cnpj,
        internalIdentifier: unit.internal_identifier || unit.name, token: this.crypto.unseal(installation.encrypted_token) }
    })
  }
}
