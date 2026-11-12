import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { PatientEntity } from '../../database/entities/patient.entity'
import { PatientIdentifierEntity } from '../../database/entities/patient-identifier.entity'
import { PatientEncounterEntity } from '../../database/entities/patient-encounter.entity'
import { PatientReviewEntity } from '../../database/entities/patient-review.entity'
import { PatientLinkDecisionEntity } from '../../database/entities/patient-link-decision.entity'
import { ExamEntity } from '../../database/entities/exam.entity'
import { PatientScopeService } from './patient-scope.service'
import { assertAssociationReversal } from './patient-review.policy'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { UndoPatientLinkDto } from './dto/patient.dto'
@Injectable()
export class PatientAssociationUndoService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: PatientScopeService,
    private readonly audit: OperationalAuditService,
  ) {}
  async undo(id: string, dto: UndoPatientLinkDto, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      const decisions = manager.getRepository(PatientLinkDecisionEntity)
      const decision = await decisions.findOne({
        where: { id, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!decision) throw new NotFoundException('Associação não encontrada.')
      assertAssociationReversal(decision.status,decision.version,dto.expectedVersion)
      await this.scope.assertManage(decision.sourcePatientId, context, manager)
      await this.scope.assertManage(decision.targetPatientId, context, manager)
      const patients = await manager
        .getRepository(PatientEntity)
        .createQueryBuilder('patient')
        .where('patient.id IN (:...ids)', {
          ids: [decision.sourcePatientId, decision.targetPatientId],
        })
        .orderBy('patient.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany()
      const source = patients.find((p) => p.id === decision.sourcePatientId),
        target = patients.find((p) => p.id === decision.targetPatientId)
      if (!source || !target)
        throw new ConflictException('Desfaça primeiro as associações posteriores.')
      assertAssociationReversal(decision.status,decision.version,dto.expectedVersion,{sourceMergedIntoId:source.mergedIntoId,targetId:target.id,targetMergedIntoId:target.mergedIntoId})
      const current = await manager
        .getRepository(ExamEntity)
        .findBy({ companyId: context.companyId, patientLinkDecisionId: id })
      if (current.some((exam) => exam.patientId !== target.id))
        throw new ConflictException('Exames associados por uma decisão posterior.')
      const examIds = current.map((e) => e.id)
      const encounterIds = [...new Set(current.map((e) => e.encounterId))]
      if (encounterIds.length) {
        const related = await manager
          .getRepository(ExamEntity)
          .findBy({ companyId: context.companyId, encounterId: In(encounterIds) })
        if (related.some((e) => !examIds.includes(e.id)))
          throw new ConflictException(
            'Atendimento utilizado por outras associações. Faça conferência antes de desfazer.',
          )
      }
      for (const original of decision.before.identifiers) {
        const identifier = await manager
          .getRepository(PatientIdentifierEntity)
          .findOneByOrFail({ id: original.id, companyId: context.companyId })
        if (identifier.patientId !== target.id || identifier.lastDecisionId !== id)
          throw new ConflictException('Identificador alterado por outra associação.')
      }
      if (examIds.length)
        await manager.getRepository(ExamEntity).update(
          { id: In(examIds) },
          {
            patientId: source.id,
            patientLinkDecisionId: null,
            patientIdentityStatus: 'IDENTIFIED',
          },
        )
      if (encounterIds.length)
        await manager
          .getRepository(PatientEncounterEntity)
          .update({ id: In(encounterIds) }, { patientId: source.id, lastDecisionId: null })
      for (const original of decision.before.identifiers)
        await manager.getRepository(PatientIdentifierEntity).update(original.id, {
          patientId: original.patientId,
          lastDecisionId: original.lastDecisionId,
        })
      for (const original of decision.before.encounters)
        await manager.getRepository(PatientEncounterEntity).update(original.id, {
          patientId: original.patientId,
          lastDecisionId: original.lastDecisionId,
        })
      for (const original of decision.before.exams)
        await manager.getRepository(ExamEntity).update(original.id, {
          patientId: original.patientId,
          encounterId: original.encounterId,
          patientIdentifierId: original.patientIdentifierId,
          patientLinkDecisionId: original.patientLinkDecisionId,
          patientIdentityStatus:
            original.patientIdentityStatus as ExamEntity['patientIdentityStatus'],
        })
      for (const original of decision.before.reviews)
        await manager.getRepository(PatientReviewEntity).update(original.id, {
          status: original.status,
          reason: dto.reason,
          decisionId: null,
          version: original.version + 2,
        })
      source.mergedIntoId = null
      source.revision++
      target.revision++
      await manager.getRepository(PatientEntity).save([source, target])
      decision.status = 'REVERTED'
      decision.version++
      await decisions.save(decision)
      await manager.query(
        `DELETE FROM patient_units link WHERE link.patient_id=$1 AND NOT(link.unit_id=ANY($2::uuid[])) AND NOT EXISTS(SELECT 1 FROM exams WHERE patient_id=$1 AND unit_id=link.unit_id) AND NOT EXISTS(SELECT 1 FROM patient_identifiers WHERE patient_id=$1 AND unit_id=link.unit_id) AND NOT EXISTS(SELECT 1 FROM patient_encounters WHERE patient_id=$1 AND unit_id=link.unit_id) AND NOT EXISTS(SELECT 1 FROM patient_reviews WHERE patient_id=$1 AND unit_id=link.unit_id)`,
        [target.id, decision.before.targetUnitIds],
      )
      await this.audit.record(
        context,
        {
          action: 'PATIENT_MATCH_REVERTED',
          resourceType: 'patient',
          resourceId: source.id,
          reason: dto.reason,
          metadata: { decisionId: id, examCount: current.length },
        },
        manager,
      )
      return { reverted: true, sourcePatientId: source.id }
    })
  }
}
