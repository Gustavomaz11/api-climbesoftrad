import { normalizeExamDescription, chooseDescriptionMapping } from './exam-description.policy'
describe('Assisted exam description normalization', () => {
  it('normalizes accents and abbreviations only through reviewed exact aliases', () => {
    expect(normalizeExamDescription('  RM  de Joélho ')).toBe('rm de joelho')
    expect(chooseDescriptionMapping([{ examTypeId: 'a', version: 2, specificity: 0 }])).toEqual({
      status: 'APPROVED',
      examTypeId: 'a',
      ruleVersion: 2,
    })
  })
  it('keeps ambiguous and unknown descriptions out of automatic classification', () => {
    expect(chooseDescriptionMapping([]).status).toBe('UNKNOWN')
    expect(
      chooseDescriptionMapping([
        { examTypeId: 'a', version: 1, specificity: 0 },
        { examTypeId: 'b', version: 1, specificity: 0 },
      ]).status,
    ).toBe('AMBIGUOUS')
  })
  it('prefers a reviewed unit/origin mapping over a generic alias', () => {
    expect(
      chooseDescriptionMapping([
        { examTypeId: 'a', version: 1, specificity: 0 },
        { examTypeId: 'b', version: 3, specificity: 2 },
      ]),
    ).toMatchObject({ status: 'APPROVED', examTypeId: 'b', ruleVersion: 3 })
  })
})
