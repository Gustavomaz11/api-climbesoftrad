import { Injectable, NotFoundException } from '@nestjs/common'
import { assertComparativeSelection } from './exam-comparative.policy'
import { DataSource } from 'typeorm'
import { ExamComparativeEntity } from '../../database/entities/exam-comparative.entity'
import { ExamEntity } from '../../database/entities/exam.entity'
import { assertExamOperationallyWritable } from '../exam-workflow/workflow-mutation-policy'
import { ExamAccessService } from '../exams/exam-access.service'
import { PatientHistoryService } from './patient-history.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
@Injectable()
export class ExamComparativesService {
  constructor(
    private readonly database: DataSource,
    private readonly exams: ExamAccessService,
    private readonly history: PatientHistoryService,
    private readonly audit: OperationalAuditService,
  ) {}
  async list(examId: string, context: CompanyAccessContext) {
    const source = await this.exams.require(examId, context)
    const links = await this.database
      .getRepository(ExamComparativeEntity)
      .findBy({ examId, companyId: context.companyId, active: true })
    const results = await Promise.all(
      links.map(async (link) => {
        try {
          const target = await this.exams.require(link.comparativeExamId, context)
          return {
            id: link.id,
            version: link.version,
            status: target.patientId === source.patientId ? 'AVAILABLE' : 'ASSOCIATION_CHANGED',
            exam: target.patientId === source.patientId ? this.history.summary(target) : null,
          }
        } catch (error: unknown) {
          if (error instanceof NotFoundException) return null
          throw error
        }
      }),
    )
    return results.filter((item) => item !== null)
  }
  async link(examId: string, targetId: string, context: CompanyAccessContext) {
    const [exam, target] = await Promise.all([
      this.exams.require(examId, context),
      this.exams.require(targetId, context),
    ])
    assertComparativeSelection(exam, target)
    return this.database.transaction(async (manager) => {
      for (const id of [examId, targetId].sort())
        await manager
          .getRepository(ExamEntity)
          .findOneOrFail({
            where: { id, companyId: context.companyId },
            lock: { mode: 'pessimistic_write' },
          })
      const current = await manager.getRepository(ExamEntity).findOneByOrFail({ id: examId })
      const currentTarget = await manager
        .getRepository(ExamEntity)
        .findOneByOrFail({ id: targetId })
      assertExamOperationallyWritable(current)
      assertComparativeSelection(current, currentTarget)
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        examId + ':' + targetId,
      ])
      const repo = manager.getRepository(ExamComparativeEntity)
      let link = await repo.findOneBy({
        examId,
        comparativeExamId: targetId,
        companyId: context.companyId,
      })
      if (link?.active) return link
      link = await repo.save(
        repo.create({
          ...link,
          companyId: context.companyId,
          examId,
          comparativeExamId: targetId,
          linkedPatientId: current.patientId,
          active: true,
          version: link ? link.version + 1 : 0,
          createdByUserId: context.userId,
        }),
      )
      await this.audit.record(
        context,
        {
          action: 'EXAM_COMPARATIVE_LINKED',
          resourceType: 'exam',
          resourceId: examId,
          unitId: exam.unitId,
          metadata: { comparativeLinkId: link.id },
        },
        manager,
      )
      return link
    })
  }
  async remove(examId: string, id: string, context: CompanyAccessContext) {
    const exam = await this.exams.require(examId, context)
    return this.database.transaction(async (manager) => {
      const current = await manager
        .getRepository(ExamEntity)
        .findOneOrFail({
          where: { id: examId, companyId: context.companyId },
          lock: { mode: 'pessimistic_write' },
        })
      assertExamOperationallyWritable(current)
      const repo = manager.getRepository(ExamComparativeEntity)
      const link = await repo.findOne({
        where: { id, examId, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!link) throw new NotFoundException('Comparativo não encontrado.')
      if (link.active) {
        link.active = false
        link.version++
        await repo.save(link)
        await this.audit.record(
          context,
          {
            action: 'EXAM_COMPARATIVE_REMOVED',
            resourceType: 'exam',
            resourceId: examId,
            unitId: exam.unitId,
            metadata: { comparativeLinkId: id },
          },
          manager,
        )
      }
      return { removed: true }
    })
  }
}
