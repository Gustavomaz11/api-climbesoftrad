import { BadRequestException } from '@nestjs/common'
interface ComparisonExam {
  id: string
  patientId: string
  performedAt: Date
}
export const assertComparativeSelection = (current: ComparisonExam, previous: ComparisonExam) => {
  if (
    current.id === previous.id ||
    current.patientId !== previous.patientId ||
    previous.performedAt >= current.performedAt
  )
    throw new BadRequestException('Selecione um exame anterior do mesmo paciente.')
}
