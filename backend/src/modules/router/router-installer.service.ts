import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DataSource } from 'typeorm'
import { CompanyScopeService } from '../companies/company-scope.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { RouterCryptoService } from './router-crypto.service'
import { RouterMsiService } from './router-msi.service'

@Injectable()
export class RouterInstallerService {
  constructor(private readonly db: DataSource, private readonly config: ConfigService, private readonly scope: CompanyScopeService,
    private readonly crypto: RouterCryptoService, private readonly audit: OperationalAuditService, private readonly msi: RouterMsiService) {}
  get root() { return resolve(this.config.get<string>('ROUTER_INSTALLER_ROOT') || '../instalavel') }
  get apiUrl() {
    const value = this.config.get<string>('ROUTER_PUBLIC_API_URL') || this.config.get<string>('PUBLIC_API_URL') || ''
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new ServiceUnavailableException('Configure um endereço HTTPS da API para gerar o Router.')
    return url.toString().replace(/\/$/, '')
  }
  async prepare(unitId: string, context: CompanyAccessContext) {
    const unit = await this.scope.requireUnit(unitId, context)
    if (!unit.active) throw new ServiceUnavailableException('Ative a unidade antes de baixar seu Router.')
    const apiUrl = this.apiUrl
    let template: Buffer, payload: Buffer
    try { template = await readFile(join(this.root, 'base', 'ClimbeSoftRadRouterSetup.exe')); payload = await readFile(join(this.root, 'base', 'router.payload.zip')) }
    catch (error) {
      Logger.error(`Modelo do Router indisponível em ${this.root}: ${error instanceof Error ? error.message : 'erro de leitura'}`, 'RouterInstallerService')
      throw new ServiceUnavailableException('O instalador do Router ainda não foi preparado no servidor.')
    }
    const id = randomUUID(), code = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 7 * 86400000)
    const certificatePath = this.config.get<string>('ROUTER_TLS_CERT_PATH')
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(apiUrl).hostname)
    const certificate = local && certificatePath ? await readFile(certificatePath, 'utf8') : ''
    const body = this.crypto.envelope({ schema: 1, unitId, unitName: unit.name, cnpj: unit.cnpj ?? '',
      internalIdentifier: unit.internalIdentifier ?? unit.name, apiUrl, ticketId: id, activationCode: code,
      expiresAt: expiresAt.toISOString(), tlsCertificatePem: certificate,
      templateSha256: createHash('sha256').update(template).digest('hex'),
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
      tlsCertificateSha256: certificate ? new X509Certificate(certificate).fingerprint256.replaceAll(':', '') : '' })
    const filename = `Router-${unitId}.msi`, directory = join(this.root, unitId, id)
    await mkdir(directory, { recursive: true })
    const file = join(directory, filename)
    // A new ticket is bound to this unit. Downloads never contain a persistent agent credential.
    await this.db.transaction(async manager => {
      await manager.query(`INSERT INTO router_installer_tickets(id,company_id,unit_id,code_hash,created_by_user_id,expires_at)
        VALUES($1,$2,$3,$4,$5,$6)`, [id, context.companyId, unitId, createHash('sha256').update(code).digest('hex'), context.userId, expiresAt])
      await writeFile(join(directory, 'router.profile.json'), body, { mode: 0o600 })
      await this.msi.build(directory, unitId)
      await this.audit.record(context, { action: 'ROUTER_INSTALLER_CREATED', resourceType: 'unit', resourceId: unitId, unitId,
        metadata: { ticketId: id, expiresAt: expiresAt.toISOString() } }, manager)
    })
    return { file, filename, expiresAt }
  }
}
