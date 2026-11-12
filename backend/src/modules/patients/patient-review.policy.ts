import { BadRequestException, ConflictException } from '@nestjs/common'
interface ReviewDecision {
  decision: 'APPROVE' | 'REJECT'
  expectedVersion: number
  targetPatientId?: string
  expectedTargetVersion?: number
}
export const assertReviewDecision = (status: string, version: number, decision: ReviewDecision) => {
  if (status !== 'OPEN' || version !== decision.expectedVersion)
    throw new ConflictException('Conferência já decidida. Recarregue.')
  if (
    decision.decision === 'APPROVE' &&
    (!decision.targetPatientId || decision.expectedTargetVersion === undefined)
  )
    throw new BadRequestException('Selecione paciente e versão da comparação.')
}
export const assertAssociationReversal = (
  status: string,
  version: number,
  expectedVersion: number,
  relationship?: {
    sourceMergedIntoId: string | null
    targetId: string
    targetMergedIntoId: string | null
  },
) => {
  if (status !== 'APPLIED' || version !== expectedVersion)
    throw new ConflictException('Associação já alterada.')
  if (
    relationship &&
    (relationship.sourceMergedIntoId !== relationship.targetId || relationship.targetMergedIntoId)
  )
    throw new ConflictException('Desfaça primeiro as associações posteriores.')
}
