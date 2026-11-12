import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
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
    return session
  }
  permission(kind: string, context: CompanyAccessContext) {
    if (!context.permissions.includes(kind === 'DICOM' ? 'dicom.import' : 'attachments.upload'))
      throw new ForbiddenException('Sem permissão para enviar esta classe de arquivo.')
  }
}
