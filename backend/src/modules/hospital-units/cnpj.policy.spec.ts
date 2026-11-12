import { normalizeCnpj, validCnpj } from './cnpj.policy'
describe('CNPJ identifiers', () => {
  it('normalizes and validates numeric and alphanumeric registrations', () => {
    expect(normalizeCnpj('37.335.118/0001-80')).toBe('37335118000180')
    expect(validCnpj('37.335.118/0001-80')).toBe(true)
    expect(validCnpj('12.ABC.345/01DE-35')).toBe(true)
  })
  it.each(['00000000000000', '37335118000181', '12.ABC.345/01DE-36', '12!ABC34501DE35', '123'])('rejects invalid registration %s', value => expect(validCnpj(value)).toBe(false))
})
