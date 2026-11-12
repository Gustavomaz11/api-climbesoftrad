import { amountToCents, choosePriceRule } from './exam-price.policy'

describe('Versioned exam pricing rules', () => {
  it('preserves cents exactly and refuses implicit rounding', () => {
    expect(amountToCents('123,45')).toBe('12345')
    expect(amountToCents('0.01')).toBe('1')
    expect(amountToCents('100')).toBe('10000')
    for (const value of ['1.234', '-1', '1e3', 'NaN', '1.000,00'])
      expect(() => amountToCents(value)).toThrow()
  })
  const base = {
    id: 'general',
    unitId: null,
    physicianId: null,
    validFrom: '2026-01-01',
    validTo: null,
  }
  it('uses the most specific physician and unit rule valid on the requested date', () => {
    const rules = [
      base,
      { ...base, id: 'unit', unitId: 'a' },
      { ...base, id: 'doctor', physicianId: 'p' },
      { ...base, id: 'both', unitId: 'a', physicianId: 'p', validTo: '2026-10-31' },
    ]
    expect(choosePriceRule(rules, 'a', 'p', '2026-10-14')?.id).toBe('both')
    expect(choosePriceRule(rules, 'a', 'p', '2026-11-01')?.id).toBe('doctor')
    expect(choosePriceRule(rules, 'b', null, '2026-10-14')?.id).toBe('general')
  })
  it('returns no price before validity and rejects equally specific conflicting rules', () => {
    expect(choosePriceRule([base], 'a', null, '2025-12-31')).toBeNull()
    expect(() =>
      choosePriceRule([base, { ...base, id: 'duplicate' }], 'a', null, '2026-10-14'),
    ).toThrow()
  })
})
