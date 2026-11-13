import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { portalKinds, type PortalKind, portalDeniedMessage } from '../companies/portal-access'
@Injectable()
export class UploadScopeService {
  constructor(
    private readonly database: DataSource,
    private readonly companies: CompanyScopeService,
  ) {}
  async require(id: string, context: CompanyAccessContext, sourceId?: string) {
    const session = await this.database
      .getRepository(UploadSessionEntity)
      .findOneBy({ id, companyId: context.companyId })
    if (!session) throw new NotFoundException('Upload não encontrado.')
    await this.companies.requireUnit(session.unitId, context)
    if (sourceId && sourceId !== session.sourceId)
      throw new NotFoundException('Upload não encontrado.')
    this.permission(session.kind, context)
    this.portal(session.kind, session.payload.hospitalIntake === true, context)
    return session
  }
  permitsPortal(kind: string, hospitalIntake: boolean, context: CompanyAccessContext) {
    if (context.integrationSourceId) return true // Router credentials have their own source/unit scope.
    const granted = context.isPlatformAdmin ? portalKinds : context.allowedPortals ?? []
    const permitted: readonly PortalKind[] = kind === 'ATTACHMENT' ? ['sourad'] : hospitalIntake ? ['hospital'] : ['sourad', 'configuracoes']
    return granted.some(p => permitted.includes(p) && (!context.portalKind || context.portalKind === p))
  }
  portal(kind: string, hospitalIntake: boolean, context: CompanyAccessContext) {
    if (!this.permitsPortal(kind, hospitalIntake, context)) throw new ForbiddenException(portalDeniedMessage)
  }
  permission(kind: string, context: CompanyAccessContext) {
    if (!context.permissions.includes(kind === 'DICOM' ? 'dicom.import' : 'attachments.upload'))
      throw new ForbiddenException('Sem permissão para enviar esta classe de arquivo.')
  }
}
