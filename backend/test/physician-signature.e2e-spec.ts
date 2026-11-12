import sharp from 'sharp'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { authenticatedTestRequest } from './authenticated-test-request'
import { syntheticSignature } from './synthetic-signature'
import { ValidationUnavailable } from '../src/modules/file-validation/clamav-scanner.service'

describe('Required physician signature onboarding', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let doctor: Awaited<ReturnType<typeof authenticatedTestRequest>>, initialPassword: string
  beforeAll(async () => {
    f = await createOperationalDocumentsFixture()
    f.scanner.scan.mockRejectedValue(new ValidationUnavailable('Scanner unavailable in the cloud'))
    const account = responseBody<{ initialPassword: string }>(await f.api('post', '/physicians').send({ email: 'doctor-13579se@integration.test', name: 'Médico de teste', crm: '13579/SE', allUnits: true }).expect(201))
    initialPassword = account.initialPassword
    doctor = await authenticatedTestRequest(f.server, '13579/SE', initialPassword)
  }, 45000)
  afterAll(async () => { await f?.app.close() })
  it('requires password change first, then signature import, before allowing clinical access', async () => {
    const bytes = await sharp(await syntheticSignature()).jpeg().toBuffer()
    expect(responseBody<{ mustChangePassword: boolean; mustUploadSignature: boolean }>(await doctor('get', '/auth/me').expect(200))).toMatchObject({ mustChangePassword: true, mustUploadSignature: true })
    await doctor('post', '/physicians/me/signature').attach('signature', bytes, { filename: 'signature.jpg', contentType: 'image/jpeg' }).expect(403)
    const changed = responseBody<{ mustChangePassword: boolean; mustUploadSignature: boolean }>(await doctor('put', '/auth/password').send({ currentPassword: initialPassword, newPassword: 'Senha nova de assinatura 2026!' }).expect(200))
    expect(changed).toMatchObject({ mustChangePassword: false, mustUploadSignature: true })
    await doctor('get', '/exams').expect(403)
    expect(responseBody<{ signature: unknown }>(await doctor('get', '/physicians/me/signature').expect(200)).signature).toBeNull()
    await doctor('post', '/physicians/me/signature').attach('signature', Buffer.from('<svg></svg>'), { filename: 'fake.png', contentType: 'image/png' }).expect(400)
    const blank = await sharp({ create: { width: 200, height: 80, channels: 3, background: 'white' } }).png().toBuffer()
    await doctor('post', '/physicians/me/signature').attach('signature', blank, { filename: 'blank.png', contentType: 'image/png' }).expect(400)
    const saved = responseBody<{ signature: { id: string; dataUrl: string; sha256: string } }>(await doctor('post', '/physicians/me/signature').attach('signature', bytes, { filename: 'signature.jpg', contentType: 'image/jpeg' }).expect(200))
    expect(saved.signature.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(saved.signature.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.signature.id).toBeTruthy()
    expect(responseBody<{ mustUploadSignature: boolean }>(await doctor('get', '/auth/me').expect(200)).mustUploadSignature).toBe(false)
    await doctor('get', '/exams').expect(200)
    expect(f.scanner.scan).not.toHaveBeenCalled()
  })
  it('keeps the signature private to its physician and rejects administrative impersonation', async () => {
    await f.api('get', '/physicians/me/signature').expect(403)
    await f.api('post', '/physicians/me/signature').attach('signature', await syntheticSignature(), { filename: 'signature.png', contentType: 'image/png' }).expect(403)
    const second = responseBody<{ initialPassword: string }>(await f.api('post', '/physicians').send({ email: 'doctor-24680se@integration.test', name: 'Outro médico de teste', crm: '24680/SE', allUnits: true }).expect(201))
    const other = await authenticatedTestRequest(f.server, '24680/SE', second.initialPassword)
    await other('put', '/auth/password').send({ currentPassword: second.initialPassword, newPassword: 'Outra senha de assinatura 2026!' }).expect(200)
    expect(responseBody<{ signature: unknown }>(await other('get', '/physicians/me/signature').expect(200)).signature).toBeNull()
    await other('get', '/exams').expect(403)
  })
})
