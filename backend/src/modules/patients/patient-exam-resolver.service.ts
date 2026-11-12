import { ConflictException, Injectable } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import { PatientEntity } from '../../database/entities/patient.entity'
import { PatientIdentifierEntity } from '../../database/entities/patient-identifier.entity'
import { PatientUnitEntity } from '../../database/entities/patient-unit.entity'
import { PatientEncounterEntity } from '../../database/entities/patient-encounter.entity'
import { PatientReviewEntity } from '../../database/entities/patient-review.entity'
import { PatientRecordsService } from './patient-records.service'
import { PatientCandidatesService } from './patient-candidates.service'
import { PatientScopeService } from './patient-scope.service'
import type { PatientDemographics } from './patient-identity.policy'
import { initialPatientIdentification } from './patient-identification-decisions'
import { externalPatientKey } from './patient-origin.policy'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
export interface PatientExamInput extends PatientDemographics {
  unitId: string
  patientId?: string
  originIssuer?: string
  externalPatientId?: string
  externalEncounterId?: string
  performedAt: string
}
@Injectable()
export class PatientExamResolverService {
  constructor(
    private readonly records: PatientRecordsService,
    private readonly candidates: PatientCandidatesService,
    private readonly scope: PatientScopeService,
    private readonly audit: OperationalAuditService,
  ) {}
  async resolve(input: PatientExamInput, context: CompanyAccessContext, manager: EntityManager) {
    const repo = manager.getRepository(PatientIdentifierEntity)
    const origin = externalPatientKey(context.companyId,input.unitId,input.originIssuer,input.externalPatientId)
    if (origin)
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify([
          context.companyId,
          input.unitId,
          origin.issuer,
          origin.originalValue,
        ]),
      ])
    let identifier = origin
      ? await repo.findOneBy(origin)
      : null
    let patient = input.patientId
      ? await this.scope.require(input.patientId, context, manager)
      : identifier
        ? await this.scope.require(identifier.patientId, context, manager)
        : null
    if (patient)
      patient = await manager.getRepository(PatientEntity).findOneOrFail({
        where: { id: patient.id, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
    if (patient?.mergedIntoId)
      throw new ConflictException(
        'Paciente associado a outro cadastro. Selecione o cadastro atual.',
      )
    if (identifier && patient && identifier.patientId !== patient.id)
      throw new ConflictException('O identificador pertence a outro paciente. Use a conferência.')
    const identity = initialPatientIdentification(patient,input,identifier?.reliable)
    const differences = identity.differences
    const known = patient
    let status: 'IDENTIFIED' | 'UNIDENTIFIED' | 'SUGGESTION' | 'CONFLICT' = identity.status
    if (status === 'CONFLICT') {
      patient = null
      status = 'CONFLICT'
      identifier = null
    }
    if (!patient)
      patient = await this.records.createInTransaction(input, input.unitId, context, manager)
    await manager
      .getRepository(PatientUnitEntity)
      .upsert({ companyId: context.companyId, patientId: patient.id, unitId: input.unitId }, [
        'patientId',
        'unitId',
      ])
    const candidates =
      status === 'CONFLICT' && known
        ? [
            {
              patientId: known.id,
              confidence: 'CONFLICT',
              reasons: ['Identificador conhecido com demografia divergente'],
            },
          ]
        : status === 'UNIDENTIFIED'
          ? await this.candidates.find(input, context, patient.id, manager)
          : []
    if (status === 'UNIDENTIFIED' && candidates.length) status = 'SUGGESTION'
    if (!identifier && input.externalPatientId && status !== 'CONFLICT') {
      identifier = await repo.save(
        repo.create({
          companyId: context.companyId,
          unitId: input.unitId,
          patientId: patient.id,
          issuer: origin!.issuer,
          originalValue: origin!.originalValue,
          source: 'EXAM',
          reliable: true,
          version: 0,
          lastDecisionId: null,
        }),
      )
      if (status === 'UNIDENTIFIED') status = 'IDENTIFIED'
      await this.audit.record(
        context,
        {
          action: 'PATIENT_IDENTIFIER_ADDED',
          resourceType: 'patient',
          resourceId: patient.id,
          unitId: input.unitId,
          metadata: { identifierId: identifier.id },
        },
        manager,
      )
    }
    if (status === 'IDENTIFIED' && identifier) {
      const pending = await manager.getRepository(PatientReviewEntity).findOneBy({
        patientId: patient.id,
        unitId: input.unitId,
        companyId: context.companyId,
        status: 'OPEN',
      })
      if (pending && ['CONFLICT', 'SUGGESTION', 'UNIDENTIFIED'].includes(pending.kind))
        status = pending.kind as typeof status
    }
    const encounter = await this.encounter(
      input,
      patient,
      identifier?.lastDecisionId ?? null,
      context,
      manager,
    )
    if (encounter.conflict) {
      status = 'CONFLICT'
      differences.push('encounterPatient')
    }
    if (status !== 'IDENTIFIED') {
      const reviews = manager.getRepository(PatientReviewEntity)
      if (
        !(await reviews.existsBy({
          patientId: patient.id,
          unitId: input.unitId,
          kind: status,
          status: 'OPEN',
        }))
      ) {
        const review = await reviews.save(
          reviews.create({
            companyId: context.companyId,
            unitId: input.unitId,
            patientId: patient.id,
            examId: null,
            kind: status,
            status: 'OPEN',
            version: 0,
            candidates: candidates.map((c) => ({
              patientId: c.patientId,
              confidence: c.confidence,
              reasons: c.reasons,
            })),
            differences,
            reason: null,
            decisionId: null,
          }),
        )
        await this.audit.record(
          context,
          {
            action: 'PATIENT_REVIEW_CREATED',
            resourceType: 'patient',
            resourceId: patient.id,
            unitId: input.unitId,
            metadata: { reviewId: review.id, kind: status },
          },
          manager,
        )
      }
    }
    return {
      patientId: patient.id,
      encounterId: encounter.record.id,
      patientIdentifierId: identifier?.id ?? null,
      patientLinkDecisionId: identifier?.lastDecisionId ?? null,
      patientIdentityStatus: status,
    }
  }
  private async encounter(
    input: PatientExamInput,
    patient: PatientEntity,
    decisionId: string | null,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    const repo = manager.getRepository(PatientEncounterEntity)
    let existing: PatientEncounterEntity | null = null
    if (input.externalEncounterId) {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify([
          'encounter',
          context.companyId,
          input.unitId,
          input.originIssuer,
          input.externalEncounterId,
        ]),
      ])
      existing = await repo.findOneBy({
        companyId: context.companyId,
        unitId: input.unitId,
        issuer: input.originIssuer,
        externalId: input.externalEncounterId,
      })
    }
    if (existing?.patientId === patient.id) return { record: existing, conflict: false }
    const record = await repo.save(
      repo.create({
        companyId: context.companyId,
        unitId: input.unitId,
        patientId: patient.id,
        issuer: input.originIssuer ?? null,
        externalId: existing ? null : (input.externalEncounterId ?? null),
        performedAt: new Date(input.performedAt),
        lastDecisionId: decisionId,
      }),
    )
    return { record, conflict: Boolean(existing) }
  }
}
