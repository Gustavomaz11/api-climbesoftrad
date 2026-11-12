import { ConfigService } from '@nestjs/config'
import { PhysicianAccessMailer } from './physician-access-mailer.service'

describe('Physician access via the shared Resend account', () => {
  const content = { subject: 'Seu acesso', text: 'Instruções sintéticas', html: '<p>ClimbeSoftRad</p>' }
  const create = (key = 're_synthetic_test_only') => new PhysicianAccessMailer(new ConfigService({
    EMAIL_PROVIDER: 'RESEND', API_RESEND_KEY: key, EMAIL_FROM: 'access@example.test', EMAIL_REPLY_TO: 'support@example.test',
  }))
  let external: jest.SpiedFunction<typeof fetch>
  beforeEach(() => {
    external = jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: 'synthetic-message-id' }), { status: 200 })))
  })
  afterEach(() => external.mockRestore())
  const options = (index = 0) => {
    const request = external.mock.calls[index]?.[1]
    if (!request || typeof request.body !== 'string') throw new Error('Missing Resend request')
    return { request, body: JSON.parse(request.body) as Record<string, unknown>, headers: new Headers(request.headers) }
  }

  it('sends through the official HTTPS API with software branding and an embedded logo', async () => {
    await create().send('doctor@example.test', 'generation-a', content)
    expect(external.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails')
    const { body, headers, request } = options()
    expect(headers.get('Authorization')).toBe('Bearer re_synthetic_test_only')
    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(body).toMatchObject({ from: 'ClimbeSoftRad <access@example.test>', to: ['doctor@example.test'], reply_to: 'support@example.test',
      tags: [{ name: 'application', value: 'climbesoftrad' }, { name: 'purpose', value: 'physician_access' }],
      attachments: [expect.objectContaining({ filename: 'climbesoftrad-logo.png', content_id: 'climbesoftrad-logo' })],
    })
  })

  it('deduplicates retries while allowing an explicit resend or updated access instructions', async () => {
    await create().send('doctor@example.test', 'generation-a', content)
    await create().send('doctor@example.test', 'generation-a', content)
    await create().send('doctor@example.test', 'generation-b', content)
    await create().send('doctor@example.test', 'generation-a', { ...content, text: 'Use sua senha atual' })
    const keys = [0, 1, 2, 3].map(index => options(index).headers.get('Idempotency-Key'))
    expect(keys[0]).toBe(keys[1]); expect(keys[0]).not.toBe(keys[2]); expect(keys[0]).not.toBe(keys[3])
    expect(keys[0]).not.toContain('doctor@example.test')
    expect(keys[0]).not.toContain(content.text)
  })

  it('does not mark API errors or malformed acknowledgements as sent', async () => {
    external.mockResolvedValueOnce(new Response(JSON.stringify({ name: 'validation_error', message: 'sensitive provider detail' }), { status: 403 }))
    await expect(create().send('doctor@example.test', 'generation-a', content)).rejects.toThrow(/^RESEND_DELIVERY_FAILED$/)
    external.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await expect(create().send('doctor@example.test', 'generation-a', content)).rejects.toThrow(/^RESEND_DELIVERY_FAILED$/)
  })

  it('sanitizes transport failures and keeps unconfigured delivery pending', async () => {
    external.mockRejectedValueOnce(new Error('Authorization: Bearer sensitive-provider-secret'))
    await expect(create().send('doctor@example.test', 'generation-a', content)).rejects.toThrow(/^RESEND_DELIVERY_FAILED$/)
    external.mockClear()
    await expect(create('').send('doctor@example.test', 'generation-a', content)).rejects.toThrow('EMAIL_NOT_CONFIGURED')
    expect(external).not.toHaveBeenCalled()
  })
})
