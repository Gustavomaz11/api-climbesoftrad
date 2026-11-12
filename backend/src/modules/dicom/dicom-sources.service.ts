import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DicomSourceEntity } from '../../database/entities/dicom-source.entity'
import { CompanyEntity } from '../../database/entities/company.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { CreateDicomSourceDto, AgentDiagnosticDto } from './dicom-source.dto'
export const dicomTokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
@Injectable()
export class DicomSourcesService {
  constructor(
    private readonly database: DataSource,
    private readonly companies: CompanyScopeService,
    private readonly audit: OperationalAuditService,
  ) {}
  async list(context: CompanyAccessContext) {
    return this.database.getRepository(DicomSourceEntity).find({
      select: {
        id: true,
        name: true,
        unitId: true,
        active: true,
        lastSeenAt: true,
        diagnostics: true,
        createdAt: true,
      },
      where: {
        companyId: context.companyId,
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      order: { createdAt: 'DESC' },
    })
  }
  async create(dto: CreateDicomSourceDto, context: CompanyAccessContext) {
    if (!(await this.companies.requireUnit(dto.unitId, context)).active)
      throw new BadRequestException('Unidade inativa.')
    const token = randomBytes(32).toString('base64url')
    const source = await this.database.transaction(async (manager) => {
      const source = await manager.getRepository(DicomSourceEntity).save({
        companyId: context.companyId,
        unitId: dto.unitId,
        name: dto.name,
        tokenHash: dicomTokenHash(token),
        createdByUserId: context.userId,
      })
      await this.audit.record(
        context,
        {
          action: 'DICOM_SOURCE_CREATED',
          resourceType: 'dicom-source',
          resourceId: source.id,
          unitId: dto.unitId,
        },
        manager,
      )
      return source
    })
    return { id: source.id, token, unitId: source.unitId }
  }
  async revoke(id: string, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      const source = await manager.getRepository(DicomSourceEntity).findOneOrFail({
        where: { id, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      await this.companies.requireUnit(source.unitId, context)
      source.active = false
      await manager.save(source)
      await this.audit.record(
        context,
        {
          action: 'DICOM_SOURCE_REVOKED',
          resourceType: 'dicom-source',
          resourceId: id,
          unitId: source.unitId,
        },
        manager,
      )
      return { id, active: false }
    })
  }
  async authenticate(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Credencial de integração inválida.')
    const source = await this.database
      .getRepository(DicomSourceEntity)
      .findOneBy({ tokenHash: dicomTokenHash(token), active: true })
    if (
      !source ||
      !(await this.database
        .getRepository(CompanyEntity)
        .existsBy({ id: source.companyId, active: true }))
    )
      throw new UnauthorizedException('Origem indisponível.')
    const context: CompanyAccessContext = {
      userId: source.createdByUserId,
      sessionId: '',
      correlationId: randomUUID(),
      role: 'USER',
      isPlatformAdmin: false,
      mustChangePassword: false,
      accessRoleId: '',
      accessRoleName: 'Agente DICOM',
      permissions: ['dicom.import', 'exams.create', 'exams.view'],
      companyId: source.companyId,
      companyName: '',
      membershipId: null,
      allUnits: false,
      unitIds: [source.unitId],
      selectedUnitId: source.unitId,
      integrationSourceId: source.id,
    }
    if (!(await this.companies.requireUnit(source.unitId, context)).active)
      throw new UnauthorizedException('Unidade inativa.')
    return { source, context }
  }
  async heartbeat(id: string, dto: AgentDiagnosticDto) {
    await this.database
      .getRepository(DicomSourceEntity)
      .update(id, { lastSeenAt: new Date(), ...dto.diagnosticOnly ? {} : { diagnostics: { ...dto } } })
    return { status: 'OK' }
  }
}
