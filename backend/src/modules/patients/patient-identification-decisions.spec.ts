import { initialPatientIdentification } from './patient-identification-decisions'
import { externalPatientKey } from './patient-origin.policy'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreatePatientDto } from './dto/patient.dto'
describe('Patient identity boundaries', () => {
  const demographics = { fullName: 'Maria Silva', birthDate: '1990-01-01', sex: 'FEMININO' }
  it('reuses known compatible identity, leaves missing identity unresolved and routes conflicts', () => {
    expect(initialPatientIdentification(demographics, { ...demographics }, true).status).toBe(
      'IDENTIFIED',
    )
    expect(initialPatientIdentification(null, demographics).status).toBe('UNIDENTIFIED')
    expect(
      initialPatientIdentification(
        demographics,
        { ...demographics, birthDate: '1991-01-01' },
        true,
      ),
    ).toMatchObject({ status: 'CONFLICT', differences: ['birthDate'] })
    expect(initialPatientIdentification(demographics, demographics, false).status).toBe('CONFLICT')
  })
  it('keeps IDs exact and separates companies, units and issuers', () => {
    const key = externalPatientKey('company', 'unit', '  Hospital  ', '000 Ab ')
    expect(key).toEqual({
      companyId: 'company',
      unitId: 'unit',
      issuer: 'Hospital',
      originalValue: '000 Ab ',
    })
    expect(externalPatientKey('other', 'unit', 'Hospital', '000 Ab ')).not.toEqual(key)
    expect(externalPatientKey('company', 'other', 'Hospital', '000 Ab ')).not.toEqual(key)
    expect(externalPatientKey('company', 'unit', 'Other', '000 Ab ')).not.toEqual(key)
    expect(externalPatientKey('company', 'unit', undefined, undefined)).toBeNull()
    expect(() => externalPatientKey('company', 'unit', undefined, '000123')).toThrow()
    expect(() => externalPatientKey('company', 'unit', 'Hospital', ' ')).toThrow()
  })
  it('validates real birth dates, demographic values and unit identity', async () => {
    const valid = {
      fullName: '  Maria   Silva ',
      country: 'Brasil',
      birthDate: '1990-01-01',
      sex: 'FEMININO',
      unitId: '6d6539a7-1f1c-4850-9ef7-95dc3812d011',
    }
    const record = plainToInstance(CreatePatientDto, valid)
    expect(await validate(record)).toEqual([])
    expect(record.fullName).toBe('Maria Silva')
    for (const override of [
      { birthDate: '1990-02-30' },
      { fullName: ' ' },
      { sex: 'UNKNOWN' },
      { unitId: 'invalid' },
    ])
      expect(
        (await validate(plainToInstance(CreatePatientDto, { ...valid, ...override }))).length,
      ).toBeGreaterThan(0)
  })
})
