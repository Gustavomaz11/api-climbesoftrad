import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { PhysicianQualificationEntity } from '../../database/entities/physician-qualification.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { ExamAccessService } from '../exams/exam-access.service'
import { qualificationMatches } from './physician-qualification.policy'
import { registryAllowsState } from './physician-registry.policy'

@Injectable()
export class ExamPhysicianEligibilityService {
  constructor(
    private readonly database: DataSource,
    private readonly exams: ExamAccessService,
  ) {}
  async eligible(examId: string, context: CompanyAccessContext) {
    const exam = await this.exams.require(examId, context)
    if (exam.normalizationStatus !== 'APPROVED' || !exam.examTypeId)
      return { items: [], reason: 'CLASSIFICATION_REQUIRED' }
    const records = await this.database.getRepository(PhysicianQualificationEntity).find({
      where: {
        companyId: context.companyId,
        unitId: exam.unitId,
        examTypeId: exam.examTypeId,
        active: true,
      },
      relations: {
        examType: true,
        unit: true,
        physician: true,
        membership: { user: true, accessRole: { permissions: true }, unitLinks: true },
      },
    })
    const items = records
      .filter(
        (record) =>
          qualificationMatches(exam, record) &&
          record.examType.active &&
          record.unit.active &&
          registryAllowsState(record.physician.registryProfile, record.unit.uf) &&
          this.operational(record),
      )
      .map((record) => ({
        physicianId: record.physicianId,
        name: record.physician.name,
        qualificationId: record.id,
        examTypeId: record.examTypeId,
        modality: record.modality,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return { items, reason: items.length ? null : 'NO_ELIGIBLE_PHYSICIAN' }
  }
  private operational(record: PhysicianQualificationEntity) {
    const membership = record.membership
    return (
      membership.active &&
      membership.user.status === 'ACTIVE' &&
      !membership.user.mustChangePassword &&
      membership.accessRole.active &&
      membership.accessRole.permissions.some((permission) => permission.code === 'reports.edit') &&
      (membership.allUnits ||
        membership.unitLinks.some((link) => link.active && link.unitId === record.unitId))
    )
  }
}
