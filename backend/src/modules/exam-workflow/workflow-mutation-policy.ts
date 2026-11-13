import { ConflictException } from '@nestjs/common'
import type { ExamEntity } from '../../database/entities/exam.entity'

export const assertExamOperationallyWritable = (
  exam: Pick<ExamEntity, 'workflowState' | 'archivedAt'>,
) => {
  if (['CANCELLED','SIGNED','RESIGNED','REVIEW','REVALIDATED'].includes(exam.workflowState) || exam.archivedAt)
    throw new ConflictException('Exame cancelado, assinado ou arquivado: ação indisponível.')
}
