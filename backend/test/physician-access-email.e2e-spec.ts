import { ConfigService } from '@nestjs/config'
import { PhysicianAccessEmails } from '../src/modules/physicians/physician-access-emails.service'
import { PhysicianAccessMailer } from '../src/modules/physicians/physician-access-mailer.service'
import { authenticatedTestRequest } from './authenticated-test-request'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'

interface Account { id: string; userId: string; membershipId: string; email: string; username: string; initialPassword: string; accessEmail: { status: string; configured: boolean } }

describe('Physician email onboarding (e2e)', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let queue: PhysicianAccessEmails, mailer: PhysicianAccessMailer, account: Account
  let configured = false
  let send: jest.SpiedFunction<PhysicianAccessMailer['send']>
  beforeAll(async () => {
    f = await createOperationalDocumentsFixture()
    queue = f.app.get(PhysicianAccessEmails); mailer = f.app.get(PhysicianAccessMailer)
    jest.spyOn(mailer, 'configured', 'get').mockImplementation(() => configured)
    send = jest.spyOn(mailer, 'send').mockResolvedValue(undefined)
    f.app.get(ConfigService).set('SOURAD_WEB_URL', 'https://climbesoftrad.example.test')
  }, 45000)
  afterAll(async () => { jest.restoreAllMocks(); await f?.app.close() })

  it('requires a valid email without creating partial accounts', async () => {
    for (const email of [undefined, '', 'invalid-address']) {
      await f.api('post', '/physicians').send({ name: 'Médico sintético', crm: '91234/SE', email }).expect(400)
    }
    expect((await f.database.query<Array<{ count: string }>>('SELECT count(*) FROM physicians'))[0]?.count).toBe('0')
  })

  it('stores the email, CRM+UF login, initial password and durable pending invitation atomically', async () => {
    account = responseBody<Account>(await f.api('post', '/physicians').send({
      name: '<Médico sintético>', crm: '91234/SE', email: ' DOCTOR@EXAMPLE.TEST ', allUnits: true,
    }).expect(201))
    expect(account).toMatchObject({ email: 'doctor@example.test', username: '91234SE', initialPassword: '91234SE', mustChangePassword: true,
      accessEmail: { status: 'PENDING', configured: false } })
    const [row] = await f.database.query<Array<Record<string, unknown>>>('SELECT * FROM physician_access_emails WHERE membership_id=$1', [account.membershipId])
    expect(row).toMatchObject({ status: 'PENDING', initial_access: true, attempts: 0 })
    expect(JSON.stringify(row)).not.toContain('91234SE')
    expect(send).not.toHaveBeenCalled()
    await f.api('post', '/physicians').send({ name: 'Duplicado', crm: '91234/SE', email: 'doctor@example.test' }).expect(409)
    expect((await f.database.query<Array<{ count: string }>>('SELECT count(*) FROM physician_access_emails'))[0]?.count).toBe('1')
  })

  it('sends queued access instructions once, with an escaped name and correct button URL', async () => {
    configured = true
    await Promise.all([queue.deliverPending(), queue.deliverPending()])
    expect(send).toHaveBeenCalledTimes(1)
    const [to, , message] = send.mock.calls[0]!
    expect(to).toBe('doctor@example.test')
    expect(message.text).toContain('Usuário: 91234SE')
    expect(message.text).toContain('Senha inicial: 91234SE')
    expect(message.text).toContain('obrigatoriamente')
    expect(message.html).toContain('href="https://climbesoftrad.example.test/login"')
    expect(message.html).toContain('&lt;Médico sintético&gt;')
    expect(message.html).not.toContain('<Médico sintético>')
    expect((await queue.summaries([account.membershipId])).get(account.membershipId)?.status).toBe('SENT')
    await f.api('post', `/physicians/${account.id}/access-email`).expect(409)
  })

  it('forces password change and never resends the obsolete default password afterwards', async () => {
    const doctor = await authenticatedTestRequest(f.server, '91234SE', account.initialPassword)
    await doctor('get', '/exams').expect(403)
    await doctor('put', '/auth/password').send({ currentPassword: account.initialPassword, newPassword: 'Senha medica nova 2026!' }).expect(200)
    await doctor('get', '/exams').expect(403) // Signature is still required.
    await f.database.query("UPDATE physician_access_emails SET sent_at=now()-interval '2 minutes' WHERE membership_id=$1", [account.membershipId])
    configured = false
    await f.api('post', `/physicians/${account.id}/access-email`).expect(201)
    configured = true
    await queue.deliverPending()
    const message = send.mock.calls.at(-1)![2]
    expect(message.text).toContain('Use sua senha atual')
    expect(message.text).not.toContain('Senha inicial:')
    expect(message.text).not.toContain('Senha medica nova 2026!')
    await expect(authenticatedTestRequest(f.server, '91234SE', account.initialPassword)).rejects.toThrow()
    await authenticatedTestRequest(f.server, '91234/SE', 'Senha medica nova 2026!')
  })

  it('keeps delivery failures visible and retries without duplicating the account', async () => {
    configured = false
    const second = responseBody<Account>(await f.api('post', '/physicians').send({ name: 'Segundo sintético', crm: '91235/SE', email: 'second@example.test' }).expect(201))
    send.mockRejectedValueOnce(new Error('SMTP provider failure with sensitive details'))
    configured = true
    await queue.deliverPending()
    expect((await queue.summaries([second.membershipId])).get(second.membershipId)?.status).toBe('FAILED')
    await queue.deliverPending()
    expect(send).toHaveBeenCalledTimes(3)
    await f.database.query('UPDATE physician_access_emails SET next_attempt_at=now() WHERE membership_id=$1', [second.membershipId])
    await queue.deliverPending()
    expect(send).toHaveBeenCalledTimes(4)
    expect((await queue.summaries([second.membershipId])).get(second.membershipId)?.status).toBe('SENT')
  })

  it('does not send revoked access or allow invitations from another company', async () => {
    configured = false
    const third = responseBody<Account>(await f.api('post', '/physicians').send({ name: 'Revogado sintético', crm: '91236/SE', email: 'third@example.test' }).expect(201))
    const other = responseBody<{ id: string }>(await f.api('post', '/companies').send({ name: 'Outra empresa sintética' }).expect(201))
    await f.api('post', `/physicians/${third.id}/access-email`, other.id).expect(404)
    await f.api('patch', `/physicians/${third.id}/revoke`).expect(200)
    await f.api('post', `/physicians/${third.id}/access-email`).expect(400)
    configured = true
    await queue.deliverPending()
    expect((await queue.summaries([third.membershipId])).get(third.membershipId)?.status).toBe('CANCELLED')
    expect(send).toHaveBeenCalledTimes(4)
  })
})
