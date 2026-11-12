import { assertReviewDecision, assertAssociationReversal } from './patient-review.policy'
describe('Patient reconciliation decisions', () => {
  const approve = {
    decision: 'APPROVE' as const,
    expectedVersion: 0,
    targetPatientId: 'target',
    expectedTargetVersion: 0,
  }
  it('requires an open current review and explicit approval target', () => {
    expect(() => assertReviewDecision('OPEN', 0, approve)).not.toThrow()
    expect(() => assertReviewDecision('REJECTED', 0, approve)).toThrow()
    expect(() => assertReviewDecision('OPEN', 1, approve)).toThrow()
    expect(() =>
      assertReviewDecision('OPEN', 0, { ...approve, targetPatientId: undefined }),
    ).toThrow()
    expect(() =>
      assertReviewDecision('OPEN', 0, { decision: 'REJECT', expectedVersion: 0 }),
    ).not.toThrow()
  })
  it('allows reversal only for the current applied decision and original patient relationship', () => {
    expect(() =>
      assertAssociationReversal('APPLIED', 0, 0, {
        sourceMergedIntoId: 'target',
        targetId: 'target',
        targetMergedIntoId: null,
      }),
    ).not.toThrow()
    expect(() => assertAssociationReversal('REVERTED', 0, 0)).toThrow()
    expect(() => assertAssociationReversal('APPLIED', 1, 0)).toThrow()
    expect(() =>
      assertAssociationReversal('APPLIED', 0, 0, {
        sourceMergedIntoId: 'other',
        targetId: 'target',
        targetMergedIntoId: null,
      }),
    ).toThrow()
    expect(() =>
      assertAssociationReversal('APPLIED', 0, 0, {
        sourceMergedIntoId: 'target',
        targetId: 'target',
        targetMergedIntoId: 'later',
      }),
    ).toThrow()
  })
})
