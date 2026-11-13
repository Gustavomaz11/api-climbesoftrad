import { ConflictException, ForbiddenException } from '@nestjs/common'
import type { ExamEntity } from '../../database/entities/exam.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'

export const assertReportOwner = (exam: ExamEntity, context: CompanyAccessContext) => {
  if (exam.reportingUserId && exam.reportingUserId !== context.userId)
    throw new ForbiddenException('Este laudo está atribuído a outro médico.')
}

export const assertReportEditing = (exam: ExamEntity, context: CompanyAccessContext) => {
  assertReportOwner(exam, context)
  if (context.role === 'DOCTOR' && (!exam.reportingUserId || exam.workflowState !== 'IN_PROGRESS'))
    throw new ConflictException('Inicie a elaboração para assumir este exame na sua fila.')
}
