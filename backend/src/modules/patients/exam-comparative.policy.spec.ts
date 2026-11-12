import { assertComparativeSelection } from './exam-comparative.policy'
import { documentAvailability } from './patient-document-availability'
describe('Authorized patient comparisons', () => {
  const current = {
    id: 'current',
    patientId: 'patient',
    performedAt: new Date('2026-10-14T12:00:00Z'),
  }
  const previous = {
    id: 'previous',
    patientId: 'patient',
    performedAt: new Date('2026-10-13T12:00:00Z'),
  }
  it('selects only an earlier exam of the same patient', () => {
    expect(() => assertComparativeSelection(current, previous)).not.toThrow()
    for (const invalid of [
      current,
      { ...previous, patientId: 'other' },
      { ...previous, performedAt: current.performedAt },
    ])
      expect(() => assertComparativeSelection(current, invalid)).toThrow()
  })
  it('keeps missing, unauthorized and mismatched documents out of availability', () => {
    expect(documentAvailability(null, previous.id)).toBe('UNAVAILABLE')
    expect(documentAvailability(undefined, previous.id)).toBe('NOT_AUTHORIZED')
    expect(
      documentAvailability(
        JSON.stringify({ examId: current.id, content: { type: 'doc' } }),
        previous.id,
      ),
    ).toBe('RECOVERY_REQUIRED')
  })
})
