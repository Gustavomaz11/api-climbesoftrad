import { resolveLegacyCompanyName } from './migrations/schema/legacy-company-mapping'

describe('Legacy ownership mapping', () => {
  it('does not assume a company for existing records', () => {
    expect(() => resolveLegacyCompanyName(undefined, 1)).toThrow('LEGACY_COMPANY_NAME')
    expect(() => resolveLegacyCompanyName(' ', 1)).toThrow('LEGACY_COMPANY_NAME')
  })

  it('accepts the explicitly confirmed company and preserves its name', () => {
    expect(resolveLegacyCompanyName(' Sourad ', 20)).toBe('Sourad')
  })

  it('creates the initial company for an empty installation', () => {
    expect(resolveLegacyCompanyName(undefined, 0)).toBe('Sourad')
  })
})
