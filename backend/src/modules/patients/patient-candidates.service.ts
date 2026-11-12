import { Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import { PatientScopeService } from './patient-scope.service'
import {
  explainCandidate,
  normalizePatientName,
  type PatientDemographics,
} from './patient-identity.policy'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
@Injectable()
export class PatientCandidatesService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: PatientScopeService,
  ) {}
  async find(
    demographics: PatientDemographics,
    context: CompanyAccessContext,
    excludeId?: string,
    manager: EntityManager = this.database.manager,
  ) {
    const name = normalizePatientName(demographics.fullName)
    const q = this.scope
      .query(context, manager)
      .andWhere('patient.merged_into_id IS NULL')
      .addSelect('similarity(patient.normalized_name,:name)', 'similarity')
      .setParameter('name', name)
      .andWhere('patient.normalized_name % :name', { name })
    if (excludeId) q.andWhere('patient.id<>:excludeId', { excludeId })
    if (demographics.birthDate)
      q.andWhere('(patient.birth_date=:birth OR patient.birth_date IS NULL)', {
        birth: demographics.birthDate,
      })
    const result = await q
      .orderBy('similarity', 'DESC')
      .addOrderBy('patient.id', 'ASC')
      .take(20)
      .getRawAndEntities<{ similarity: number }>()
    return result.entities.map((patient, index) => ({
      patientId: patient.id,
      fullName: patient.fullName,
      birthDate: patient.birthDate,
      sex: patient.sex,
      revision: patient.revision,
      ...explainCandidate(demographics, patient, Number(result.raw[index]?.similarity ?? 0)),
    }))
  }
}
