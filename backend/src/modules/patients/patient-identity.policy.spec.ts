import {
  demographicDifferences,
  normalizePatientName,
  explainCandidate,
} from './patient-identity.policy'
const maria = { fullName: 'Maria da Silva', birthDate: '1990-01-01', sex: 'FEMININO' }
describe('Patient identification evidence', () => {
  it('keeps accents and spacing out of demographic comparisons without changing original names', () => {
    expect(normalizePatientName('  MáRia   da Sílva ')).toBe('maria da silva')
    expect(demographicDifferences(maria, { ...maria, fullName: 'MARIA DA SILVA' })).toEqual([])
  })
  it('flags birth date, sex and name conflicts even when the origin identifier matches', () => {
    expect(
      demographicDifferences(maria, {
        fullName: 'Maria Souza',
        birthDate: '1991-01-01',
        sex: 'MASCULINO',
      }),
    ).toEqual(['fullName', 'birthDate', 'sex'])
  })
  it('does not infer identity from a homonym or incomplete demographic evidence', () => {
    expect(explainCandidate(maria, maria, 1)).toMatchObject({
      confidence: 'HIGH',
      reasons: ['Nome normalizado igual', 'Nascimento igual', 'Sexo igual'],
      automatic: false,
    })
    expect(explainCandidate({ fullName: 'João' }, { fullName: 'João' }, 1).confidence).toBe('LOW')
  })
  it('explains spelling differences and never proposes incompatible birth dates', () => {
    expect(explainCandidate(maria, { ...maria, fullName: 'Maria da Siva' }, 0.8).confidence).toBe(
      'MEDIUM',
    )
    expect(explainCandidate(maria, { ...maria, birthDate: '1970-01-01' }, 1).confidence).toBe('LOW')
  })
})
