import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource, In, type EntityManager } from 'typeorm'
import { PatientEntity } from '../../database/entities/patient.entity'
import { PatientUnitEntity } from '../../database/entities/patient-unit.entity'
import { PatientIdentifierEntity } from '../../database/entities/patient-identifier.entity'
import { PatientEncounterEntity } from '../../database/entities/patient-encounter.entity'
import { PatientReviewEntity } from '../../database/entities/patient-review.entity'
import { PatientLinkDecisionEntity } from '../../database/entities/patient-link-decision.entity'
import { ExamEntity } from '../../database/entities/exam.entity'
import { PatientAssociationUndoService } from './patient-association-undo.service'
import { PatientScopeService } from './patient-scope.service'
import { assertReviewDecision } from './patient-review.policy'
import { PatientCandidatesService } from './patient-candidates.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { DecidePatientReviewDto, UndoPatientLinkDto } from './dto/patient.dto'
@Injectable()
export class PatientReviewsService {
  constructor(
    private readonly database: DataSource,
    private readonly undoService: PatientAssociationUndoService,
    private readonly scope: PatientScopeService,
    private readonly candidates: PatientCandidatesService,
    private readonly audit: OperationalAuditService,
  ) {}
  async list(context: CompanyAccessContext, status = 'OPEN') {
    const reviews = await this.database.getRepository(PatientReviewEntity).find({
      where: {
        companyId: context.companyId,
        status,
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      order: { createdAt: 'ASC' },
      take: 100,
    })
    return Promise.all(
      reviews.map(async (review) => {
        const patient = await this.scope.require(review.patientId, context)
        const candidates = await this.candidates.find(patient, context, patient.id)
        for (const candidate of review.candidates) {
          if (candidates.some((c) => c.patientId === candidate.patientId)) continue
          try {
            const known = await this.scope.require(candidate.patientId, context)
            candidates.push({
              patientId: known.id,
              fullName: known.fullName,
              birthDate: known.birthDate,
              sex: known.sex,
              revision: known.revision,
              confidence: candidate.confidence,
              reasons: candidate.reasons,
              automatic: false,
            })
          } catch (error: unknown) {
            if (!(error instanceof NotFoundException)) throw error
          }
        }
        const decision = review.decisionId
          ? await this.database
              .getRepository(PatientLinkDecisionEntity)
              .findOneBy({ id: review.decisionId, companyId: context.companyId })
          : null
        return {
          ...review,
          patient,
          candidates,
          canManage: await this.scope.canManage(patient.id, context),
          decision: decision
            ? {
                id: decision.id,
                status: decision.status,
                version: decision.version,
                targetPatientId:
                  context.allUnits ||
                  (await this.scope.canManage(decision.targetPatientId, context))
                    ? decision.targetPatientId
                    : null,
                examCount: decision.before.exams.length,
                identifierCount: decision.before.identifiers.length,
              }
            : null,
        }
      }),
    )
  }
  async open(
    patientId: string,
    expectedVersion: number,
    reason: string,
    context: CompanyAccessContext,
  ) {
    return this.database.transaction(async (manager) => {
      await this.scope.assertManage(patientId, context, manager)
      const patient = await manager.getRepository(PatientEntity).findOneOrFail({
        where: { id: patientId, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      if (patient.mergedIntoId || patient.revision !== expectedVersion)
        throw new ConflictException('Cadastro alterado. Recarregue antes de conferir.')
      const reviews = manager.getRepository(PatientReviewEntity)
      const existing = await reviews.findOneBy({
        patientId,
        companyId: context.companyId,
        status: 'OPEN',
      })
      if (existing) return existing
      const unit = await manager
        .getRepository(PatientUnitEntity)
        .findOneByOrFail({ patientId, companyId: context.companyId })
      const review = await reviews.save(
        reviews.create({
          companyId: context.companyId,
          unitId: unit.unitId,
          patientId,
          examId: null,
          kind: 'CONFLICT',
          status: 'OPEN',
          version: 0,
          candidates: [],
          differences: [],
          reason,
          decisionId: null,
        }),
      )
      await this.audit.record(
        context,
        {
          action: 'PATIENT_REVIEW_CREATED',
          resourceType: 'patient',
          resourceId: patientId,
          unitId: unit.unitId,
          reason,
          metadata: { reviewId: review.id, kind: 'CONFLICT' },
        },
        manager,
      )
      return review
    })
  }
  async decide(id: string, dto: DecidePatientReviewDto, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      const review = await this.review(
        id,
        context,
        manager,
        dto.decision === 'APPROVE' ? dto.targetPatientId : undefined,
      )
      assertReviewDecision(review.status,review.version,dto)
      const source = await this.scope.require(review.patientId, context, manager)
      if (source.revision !== dto.expectedSourceVersion)
        throw new ConflictException('Paciente alterado. Recarregue a comparação.')
      await this.scope.assertManage(source.id, context, manager)
      if (dto.decision === 'REJECT') {
        review.status = 'REJECTED'
        review.reason = dto.reason
        review.version++
        await manager.getRepository(PatientReviewEntity).save(review)
        const reconciled = await this.settleRejectedReview(review, manager)
        await this.audit.record(
          context,
          {
            action: 'PATIENT_MATCH_REJECTED',
            resourceType: 'patient',
            resourceId: source.id,
            unitId: review.unitId,
            reason: dto.reason,
            metadata: { reviewId: id, reconciledExamCount: reconciled.length },
          },
          manager,
        )
        return review
      }
      return this.merge(review, dto, context, manager)
    })
  }
  private async settleRejectedReview(review: PatientReviewEntity, manager: EntityManager) {
    if (!['CONFLICT', 'SUGGESTION'].includes(review.kind)) return []
    return manager.query<Array<{ id: string }>>(
      `WITH changed AS (UPDATE exams e SET patient_identity_status=CASE WHEN EXISTS(
        SELECT 1 FROM patient_identifiers i WHERE i.id=e.patient_identifier_id
          AND i.company_id=e.company_id AND i.patient_id=e.patient_id AND i.unit_id=e.unit_id AND i.reliable
        ) THEN 'IDENTIFIED' ELSE 'UNIDENTIFIED' END,updated_at=now()
      WHERE e.company_id=$1 AND e.patient_id=$2 AND e.unit_id=$3
        AND e.patient_identity_status IN ('CONFLICT','SUGGESTION') AND e.created_at<=$4 AND NOT EXISTS(
          SELECT 1 FROM patient_reviews pending WHERE pending.company_id=e.company_id
            AND pending.patient_id=e.patient_id AND pending.unit_id=e.unit_id
            AND pending.status='OPEN' AND pending.kind IN ('CONFLICT','SUGGESTION')
        ) RETURNING e.id) SELECT id FROM changed`,
      [review.companyId, review.patientId, review.unitId, review.updatedAt],
    )
  }
  private async merge(
    review: PatientReviewEntity,
    dto: DecidePatientReviewDto,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    const targetId = dto.targetPatientId!
    if (targetId === review.patientId) throw new BadRequestException('Escolha outro cadastro.')
    await this.scope.assertManage(targetId, context, manager)
    const patients = await manager
      .getRepository(PatientEntity)
      .createQueryBuilder('patient')
      .where('patient.id IN (:...ids) AND patient.company_id=:companyId', {
        ids: [review.patientId, targetId],
        companyId: context.companyId,
      })
      .orderBy('patient.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany()
    const source = patients.find((p) => p.id === review.patientId),
      target = patients.find((p) => p.id === targetId)
    if (
      !source ||
      !target ||
      source.mergedIntoId ||
      target.mergedIntoId ||
      source.revision !== dto.expectedSourceVersion ||
      target.revision !== dto.expectedTargetVersion
    )
      throw new ConflictException('Associação ou cadastro mudou. Recarregue a conferência.')
    const [exams, identifiers, encounters, units, reviews] = await Promise.all([
      manager
        .getRepository(ExamEntity)
        .findBy({ patientId: source.id, companyId: context.companyId }),
      manager
        .getRepository(PatientIdentifierEntity)
        .findBy({ patientId: source.id, companyId: context.companyId }),
      manager
        .getRepository(PatientEncounterEntity)
        .findBy({ patientId: source.id, companyId: context.companyId }),
      manager
        .getRepository(PatientUnitEntity)
        .findBy({ patientId: target.id, companyId: context.companyId }),
      manager
        .getRepository(PatientReviewEntity)
        .findBy({ patientId: source.id, companyId: context.companyId, status: 'OPEN' }),
    ])
    const decision = await manager.getRepository(PatientLinkDecisionEntity).save({
      companyId: context.companyId,
      reviewId: review.id,
      sourcePatientId: source.id,
      targetPatientId: target.id,
      status: 'APPLIED',
      version: 0,
      reason: dto.reason,
      actorUserId: context.userId,
      before: {
        targetUnitIds: units.map((u) => u.unitId),
        exams: exams.map((e) => ({
          id: e.id,
          patientId: e.patientId,
          encounterId: e.encounterId,
          patientIdentifierId: e.patientIdentifierId,
          patientLinkDecisionId: e.patientLinkDecisionId,
          patientIdentityStatus: e.patientIdentityStatus,
        })),
        identifiers: identifiers.map((i) => ({
          id: i.id,
          patientId: i.patientId,
          lastDecisionId: i.lastDecisionId,
        })),
        encounters: encounters.map((e) => ({
          id: e.id,
          patientId: e.patientId,
          lastDecisionId: e.lastDecisionId,
        })),
        reviews: reviews.map((r) => ({
          id: r.id,
          status: r.status,
          version: r.version,
          decisionId: r.decisionId,
          reason: r.reason,
        })),
      },
    })
    const sourceUnits = await manager
      .getRepository(PatientUnitEntity)
      .findBy({ patientId: source.id, companyId: context.companyId })
    for (const unit of sourceUnits)
      await manager
        .getRepository(PatientUnitEntity)
        .upsert({ companyId: context.companyId, patientId: target.id, unitId: unit.unitId }, [
          'patientId',
          'unitId',
        ])
    await manager
      .getRepository(PatientIdentifierEntity)
      .update(
        { patientId: source.id, companyId: context.companyId },
        { patientId: target.id, lastDecisionId: decision.id },
      )
    await manager
      .getRepository(PatientEncounterEntity)
      .update(
        { patientId: source.id, companyId: context.companyId },
        { patientId: target.id, lastDecisionId: decision.id },
      )
    await manager.getRepository(ExamEntity).update(
      { patientId: source.id, companyId: context.companyId },
      {
        patientId: target.id,
        patientLinkDecisionId: decision.id,
        patientIdentityStatus: 'IDENTIFIED',
      },
    )
    source.mergedIntoId = target.id
    source.revision++
    target.revision++
    await manager.getRepository(PatientEntity).save([source, target])
    for (const current of reviews) {
      current.status = 'APPROVED'
      current.reason = dto.reason
      current.decisionId = decision.id
      current.version++
      await manager.getRepository(PatientReviewEntity).save(current)
    }
    await this.audit.record(
      context,
      {
        action: 'PATIENT_MATCH_APPROVED',
        resourceType: 'patient',
        resourceId: target.id,
        unitId: review.unitId,
        reason: dto.reason,
        metadata: {
          sourcePatientId: source.id,
          decisionId: decision.id,
          examCount: exams.length,
          identifierCount: identifiers.length,
        },
      },
      manager,
    )
    return { decisionId: decision.id, version: 0, targetPatientId: target.id }
  }
  undo(id: string, dto: UndoPatientLinkDto, context: CompanyAccessContext) {
    return this.undoService.undo(id, dto, context)
  }
  private async review(
    id: string,
    context: CompanyAccessContext,
    manager: EntityManager,
    targetId?: string,
  ) {
    const review = await manager.getRepository(PatientReviewEntity).findOne({
      where: {
        id,
        companyId: context.companyId,
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      lock: { mode: 'pessimistic_write' },
    })
    if (!review) throw new NotFoundException('Conferência não encontrada.')
    const ids = targetId ? [review.patientId, targetId] : [review.patientId]
    for (const patientId of ids) await this.scope.assertManage(patientId, context, manager)
    await manager
      .getRepository(PatientEntity)
      .createQueryBuilder('patient')
      .where('patient.company_id=:companyId AND patient.id IN (:...ids)', {
        companyId: context.companyId,
        ids,
      })
      .orderBy('patient.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany()
    return manager
      .getRepository(PatientReviewEntity)
      .findOneOrFail({
        where: { id, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
  }
}
