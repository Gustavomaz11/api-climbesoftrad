import { ConfigService } from '@nestjs/config'
import { CnpjaService } from './cnpja.service'
describe('CNPJá company lookup', () => {
  afterEach(() => jest.restoreAllMocks())
  it('maps only registration, address and contact, without exposing the provider key', async () => {
    const provider = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ taxId: '37335118000180', company: { name: 'Empresa de teste', members: [{ taxId: 'private-person' }] }, alias: 'Hospital de teste', address: { street: 'Rua A', number: '10', district: 'Centro', city: 'Aracaju', state: 'SE', zip: '49000000' }, phones: [{ area: '79', number: '999999999' }], emails: [{ address: 'hospital@example.test' }] })))
    const result = await new CnpjaService(new ConfigService({ CNPJA: 'provider-secret' })).lookup('37.335.118/0001-80')
    expect(result).toMatchObject({ legalName: 'Empresa de teste', tradeName: 'Hospital de teste', address: { zipCode: '49000000', neighborhood: 'Centro' }, contactPhone: '79999999999', contactEmail: 'hospital@example.test' })
    expect(JSON.stringify(result)).not.toContain('private-person')
    expect(JSON.stringify(result)).not.toContain('provider-secret')
    expect(provider.mock.calls[0]?.[0]).toBe('https://api.cnpja.com/office/37335118000180')
    expect(provider.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'provider-secret', Accept: 'application/json' })
  })
  it('sanitizes provider failures and rejects a response for a different company', async () => {
    const provider = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('provider-secret', { status: 401 }))
    const service = new CnpjaService(new ConfigService({ CNPJA: 'provider-secret' }))
    await expect(service.lookup('37335118000180')).rejects.not.toThrow('provider-secret')
    provider.mockResolvedValue(new Response(JSON.stringify({ taxId: '12345678901234', company: { name: 'Wrong' }, address: {} })))
    await expect(service.lookup('37335118000180')).rejects.toThrow('inconsistente')
  })
})
