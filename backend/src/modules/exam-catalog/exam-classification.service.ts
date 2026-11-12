import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, In, Not } from 'typeorm'
import { ExamEntity } from '../../database/entities/exam.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { ExamDescriptionResolverService } from './exam-description-resolver.service'
import { ExamCatalogService } from './exam-catalog.service'
import type { ClassifyExamDto } from './dto/exam-catalog.dto'
@Injectable()
export class ExamClassificationService {
  constructor(
    private readonly database: DataSource,
    private readonly resolver: ExamDescriptionResolverService,
    private readonly catalog: ExamCatalogService,
    private readonly audit: OperationalAuditService,
  ) {}
  list(context: CompanyAccessContext) {
    return this.database.getRepository(ExamEntity).find({
      where: {
        companyId: context.companyId,
        normalizationStatus: Not('APPROVED'),
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      order: { performedAt: 'DESC' },
      take: 100,
    })
  }
  async classify(id: string, dto: ClassifyExamDto, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      const repo = manager.getRepository(ExamEntity)
      const exam = await repo.findOne({
        where: {
          id,
          companyId: context.companyId,
          ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
        },
        lock: { mode: 'pessimistic_write' },
      })
      if (!exam) throw new NotFoundException('Exame não encontrado.')
      if (exam.updatedAt.toISOString() !== new Date(dto.expectedUpdatedAt).toISOString())
        throw new ConflictException('Exame alterado. Recarregue a conferência.')
      await this.resolver.requireType(dto.examTypeId, exam.modality, context, manager)
      let alias = null
      if (dto.teachAlias) {
        if (!context.permissions.includes('exam.catalog.manage'))
          throw new ConflictException('Você não pode alterar mapeamentos do catálogo.')
        alias = await this.catalog.learnAlias(
          {
            examTypeId: dto.examTypeId,
            unitId: exam.unitId,
            issuer: exam.originIssuer ?? undefined,
            description: exam.studyDescription,
            active: true,
          },
          context,
          manager,
        )
      }
      Object.assign(exam, {
        examTypeId: dto.examTypeId,
        normalizationStatus: 'APPROVED',
        normalizationAliasId: alias?.id ?? null,
        normalizationRuleVersion: alias?.version ?? null,
      })
      await repo.save(exam)
      await this.audit.record(
        context,
        {
          action: 'EXAM_CLASSIFICATION_REVIEWED',
          resourceType: 'exam',
          resourceId: id,
          unitId: exam.unitId,
          reason: dto.reason,
          metadata: { examTypeId: dto.examTypeId, ruleVersion: alias?.version ?? null },
        },
        manager,
      )
      return exam
    })
  }
}
