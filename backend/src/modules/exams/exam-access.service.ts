import { Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { ExamEntity } from '../../database/entities/exam.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'

@Injectable()
export class ExamAccessService {
  constructor(private readonly database: DataSource) {}

  async require(examId: string, context: CompanyAccessContext) {
    const exam = await this.database.getRepository(ExamEntity).findOne({
      where: {
        id: examId,
        companyId: context.companyId,
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      relations: { unit: true },
    })
    if (!exam) throw new NotFoundException('Exame não encontrado.')
    return exam
  }
}
