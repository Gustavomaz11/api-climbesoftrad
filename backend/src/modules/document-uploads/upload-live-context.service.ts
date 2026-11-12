import { Injectable, UnauthorizedException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { DicomSourceEntity } from '../../database/entities/dicom-source.entity'
import type { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
@Injectable()
export class UploadLiveContextService {
  constructor(
    private readonly database: DataSource,
    private readonly companies: CompanyScopeService,
  ) {}
  async resolve(upload: UploadSessionEntity): Promise<CompanyAccessContext> {
    if (upload.sourceId) {
      const source = await this.database.getRepository(DicomSourceEntity).findOneBy({
        id: upload.sourceId,
        companyId: upload.companyId,
        unitId: upload.unitId,
        active: true,
      })
      if (!source) throw new UnauthorizedException('Origem revogada.')
      const unit = await this.companies.requireUnit(upload.unitId, upload.context)
      if (!unit.active) throw new UnauthorizedException('Unidade inativa.')
      return upload.context
    }
    return this.user(upload.context)
  }
  async user(context: CompanyAccessContext) {
    const session = await this.database
      .getRepository(AuthSessionEntity)
      .findOneBy({ id: context.sessionId, userId: context.userId })
    const user = await this.database
      .getRepository(AuthUserEntity)
      .findOneBy({ id: context.userId, status: 'ACTIVE' })
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !user ||
      user.mustChangePassword
    )
      throw new UnauthorizedException('Sessão indisponível.')
    return this.companies.resolve(
      { ...context, role: user.role, isPlatformAdmin: user.role === 'ADMIN' },
      context.companyId,
      context.selectedUnitId ?? undefined,
    )
  }
}
