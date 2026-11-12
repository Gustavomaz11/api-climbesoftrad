import { qualificationMatches } from './physician-qualification.policy'

describe('Canonical exam qualification', () => {
  const exam = {
    unitId: 'unit-a',
    examTypeId: 'type-a',
    modality: 'CT',
    normalizationStatus: 'APPROVED',
  }
  const qualification = { unitId: 'unit-a', examTypeId: 'type-a', modality: 'CT', active: true }
  it('requires the exact canonical type, modality and unit', () => {
    expect(qualificationMatches(exam, qualification)).toBe(true)
    for (const value of [
      { unitId: 'unit-b' },
      { examTypeId: 'type-b' },
      { modality: 'MR' },
      { active: false },
    ])
      expect(qualificationMatches(exam, { ...qualification, ...value })).toBe(false)
  })
  it('keeps unknown, ambiguous and unclassified exams out of eligibility', () => {
    for (const normalizationStatus of ['UNKNOWN', 'AMBIGUOUS', 'INACTIVE'])
      expect(qualificationMatches({ ...exam, normalizationStatus }, qualification)).toBe(false)
    expect(qualificationMatches({ ...exam, examTypeId: null }, qualification)).toBe(false)
  })
})
