import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import { PatientEntity } from '../../database/entities/patient.entity'
import { HospitalUnitEntity } from '../../database/entities/hospital-unit.entity'
import { PatientUnitEntity } from '../../database/entities/patient-unit.entity'
import { PatientRevisionEntity } from '../../database/entities/patient-revision.entity'
import { PatientIdentifierEntity } from '../../database/entities/patient-identifier.entity'
import { PatientReviewEntity } from '../../database/entities/patient-review.entity'
import { PatientScopeService } from './patient-scope.service'
import { normalizePatientName, type PatientDemographics } from './patient-identity.policy'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { AddIdentifierDto, CorrectPatientDto, CreatePatientDto } from './dto/patient.dto'
@Injectable()
export class PatientRecordsService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: PatientScopeService,
    private readonly companyScope: CompanyScopeService,
    private readonly audit: OperationalAuditService,
  ) {}
  async list(context: CompanyAccessContext, search?: string) {
    const q = this.scope.query(context).andWhere('patient.merged_into_id IS NULL')
    if (search?.trim())
      q.andWhere('patient.normalized_name ILIKE :name', {
        name: '%' + normalizePatientName(search).replace(/[\\%_]/g, '\\$&') + '%',
      })
    const patients = await q.orderBy('patient.full_name', 'ASC').take(100).getMany()
    return Promise.all(
      patients.map(async (p) => ({ ...p, canManage: await this.scope.canManage(p.id, context) })),
    )
  }
  async detail(id: string, context: CompanyAccessContext) {
    const patient = await this.scope.require(id, context)
    const identifiers = await this.database
      .getRepository(PatientIdentifierEntity)
      .findBy({ patientId: id, companyId: context.companyId })
    const revisions = await this.database
      .getRepository(PatientRevisionEntity)
      .find({ where: { patientId: id, companyId: context.companyId }, order: { version: 'DESC' } })
    const reviews = await this.database
      .getRepository(PatientReviewEntity)
      .findBy({ patientId: id, companyId: context.companyId })
    return {
      ...patient,
      canManage: await this.scope.canManage(id, context),
      identifiers: await Promise.all(
        identifiers
          .filter((i) => context.allUnits || context.unitIds.includes(i.unitId))
          .map(async (i) => ({
            ...i,
            unitName:
              (
                await this.database
                  .getRepository(HospitalUnitEntity)
                  .findOneBy({ id: i.unitId, companyId: context.companyId })
              )?.name ?? i.unitId,
          })),
      ),
      revisions,
      reviews: reviews
        .filter((r) => context.allUnits || context.unitIds.includes(r.unitId))
        .map((r) => ({ ...r, candidates: [] })),
    }
  }
  async create(dto: CreatePatientDto, context: CompanyAccessContext) {
    const unit = await this.companyScope.requireUnit(dto.unitId, context)
    if (!unit.active) throw new BadRequestException('Unidade inativa.')
    return this.database.transaction((manager) =>
      this.createInTransaction(dto, dto.unitId, context, manager),
    )
  }
  async createInTransaction(
    data: PatientDemographics,
    unitId: string,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    const repo = manager.getRepository(PatientEntity)
    const patient = await repo.save(
      repo.create({
        companyId: context.companyId,
        fullName: data.fullName,
        socialName: data.socialName || null,
        birthDate: data.birthDate || null,
        sex: data.sex || null,
        country: data.country || 'Brasil',
        email: data.email || null,
        normalizedName: normalizePatientName(data.fullName),
        revision: 0,
        mergedIntoId: null,
      }),
    )
    await manager
      .getRepository(PatientUnitEntity)
      .save({ companyId: context.companyId, patientId: patient.id, unitId })
    await this.revision(patient, 'Cadastro inicial', context, manager)
    await this.audit.record(
      context,
      { action: 'PATIENT_CREATED', resourceType: 'patient', resourceId: patient.id, unitId },
      manager,
    )
    return patient
  }
  async correct(id: string, dto: CorrectPatientDto, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      await this.scope.assertManage(id, context, manager)
      const repo = manager.getRepository(PatientEntity)
      const patient = await repo.findOneOrFail({
        where: { id, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      if (patient.mergedIntoId || patient.revision !== dto.expectedVersion)
        throw new ConflictException('Cadastro alterado ou associado. Recarregue antes de corrigir.')
      Object.assign(patient, {
        fullName: dto.fullName,
        socialName: dto.socialName || null,
        birthDate: dto.birthDate || null,
        sex: dto.sex || null,
        country: dto.country,
        email: dto.email || null,
        normalizedName: normalizePatientName(dto.fullName),
        revision: patient.revision + 1,
      })
      await repo.save(patient)
      const revision = await this.revision(patient, dto.reason, context, manager)
      await this.audit.record(
        context,
        {
          action: 'PATIENT_CORRECTED',
          resourceType: 'patient',
          resourceId: id,
          reason: dto.reason,
          metadata: { revisionId: revision.id, version: patient.revision },
        },
        manager,
      )
      return patient
    })
  }
  async identifier(id: string, dto: AddIdentifierDto, context: CompanyAccessContext) {
    const unit = await this.companyScope.requireUnit(dto.unitId, context)
    if (!unit.active) throw new BadRequestException('Unidade inativa.')
    return this.database.transaction(async (manager) => {
      await this.scope.assertManage(id, context, manager)
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify([context.companyId, dto.unitId, dto.issuer, dto.originalValue]),
      ])
      const patient = await manager.getRepository(PatientEntity).findOneOrFail({
        where: { id, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      if (patient.mergedIntoId)
        throw new ConflictException('Selecione o cadastro atual do paciente.')
      await this.scope.assertManage(id, context, manager)
      const repo = manager.getRepository(PatientIdentifierEntity)
      const existing = await repo.findOneBy({
        companyId: context.companyId,
        unitId: dto.unitId,
        issuer: dto.issuer,
        originalValue: dto.originalValue,
      })
      if (existing) {
        if (existing.patientId !== id)
          throw new ConflictException('Identificador já associado. Use a conferência de pacientes.')
        return existing
      }
      await manager
        .getRepository(PatientUnitEntity)
        .upsert({ companyId: context.companyId, patientId: id, unitId: dto.unitId }, [
          'patientId',
          'unitId',
        ])
      const identifier = await repo.save(
        repo.create({
          companyId: context.companyId,
          patientId: id,
          unitId: dto.unitId,
          issuer: dto.issuer,
          originalValue: dto.originalValue,
          source: 'MANUAL',
          reliable: true,
          version: 0,
          lastDecisionId: null,
        }),
      )
      await this.audit.record(
        context,
        {
          action: 'PATIENT_IDENTIFIER_ADDED',
          resourceType: 'patient',
          resourceId: id,
          unitId: dto.unitId,
          reason: dto.reason,
          metadata: { identifierId: identifier.id },
        },
        manager,
      )
      return identifier
    })
  }
  private revision(
    patient: PatientEntity,
    reason: string,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    return manager.getRepository(PatientRevisionEntity).save({
      companyId: context.companyId,
      patientId: patient.id,
      version: patient.revision,
      demographics: {
        fullName: patient.fullName,
        socialName: patient.socialName,
        birthDate: patient.birthDate,
        sex: patient.sex,
        country: patient.country,
        email: patient.email,
      },
      reason,
      actorUserId: context.userId,
    })
  }
}
