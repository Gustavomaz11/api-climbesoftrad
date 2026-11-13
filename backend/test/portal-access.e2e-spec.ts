import { syntheticSignature } from './synthetic-signature'
import { createHash, randomBytes } from 'node:crypto'
import request from 'supertest'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { authenticatedTestRequest } from './authenticated-test-request'

describe('Explicit access to the three portals', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let administratorRole: string
  const password = 'Senha sintética dos portais 2026!'
  const account = async (email: string, allowedPortals: string[]) => {
    const created = responseBody<{ id: string; initialPassword: string }>(await f.api('post', '/company-memberships').send({
      email, fullName: 'Pessoa sintética dos portais', roleId: administratorRole, allUnits: true, unitIds: [], allowedPortals,
    }).expect(201))
    const api = await authenticatedTestRequest(f.server, email, created.initialPassword)
    await api('put', '/auth/password').send({ currentPassword: created.initialPassword, newPassword: password }).expect(200)
    return { api, ...created }
  }
  beforeAll(async () => {
    f = await createOperationalDocumentsFixture()
    const roles = responseBody<Array<{ id: string; code: string }>>(await f.api('get', '/access-control/roles').expect(200))
    administratorRole = roles.find(r => r.code === 'ADMINISTRATOR')!.id
  }, 30000)
  afterAll(async () => { await f?.app.close() })

  it('blocks hospital and management even with broad role permissions and an omitted or forged portal header', async () => {
    const { api } = await account('reporting-only@portals.example.test', ['sourad'])
    await api('get', '/exams').set('X-Portal-Kind', 'sourad').expect(200)
    for (const header of [null, 'sourad', 'configuracoes', 'hospital']) {
      for (const path of ['/company-memberships', '/hospital/intakes']) {
        const operation = api('get', path)
        if (header) operation.set('X-Portal-Kind', header)
        await operation.expect(403)
      }
    }
    await api('get', '/exams').set('X-Portal-Kind', 'invalid').expect(400)
    await api('post', '/uploads').send({ kind: 'DICOM', hospitalIntake: true, unitId: f.unit, name: 'study.dcm', contentType: 'application/dicom', sizeBytes: 500, sha256: 'a'.repeat(64) }).expect(403)
    const profile = responseBody<{ allowedPortals: string[] }>(await api('get', '/auth/me').expect(200))
    expect(profile.allowedPortals).toEqual(['sourad'])
  })

  it('denies login to an unauthorized portal without treating a correct password as a failed password', async () => {
    const { api } = await account('login-only@portals.example.test', ['sourad'])
    for (const portalKind of ['hospital', 'configuracoes']) {
      await request(f.server).post('/api/v1/auth/login').send({
        email: 'login-only@portals.example.test', password, portalKind, clientId: 'crm-web',
        codeChallenge: createHash('sha256').update(randomBytes(64)).digest('base64url'), codeChallengeMethod: 'S256', state: randomBytes(32).toString('base64url'),
      }).expect(403)
    }
    await api('get', '/exams').expect(200)
    const [user] = await f.database.query<Array<{ failed_login_attempts: number }>>("SELECT failed_login_attempts FROM auth_users WHERE email='login-only@portals.example.test'")
    expect(user?.failed_login_attempts).toBe(0)
  })

  it('applies an edited grant immediately to an existing session and records the change', async () => {
    const { api, id } = await account('editable@portals.example.test', ['sourad', 'hospital'])
    await api('get', '/hospital/intakes').set('X-Portal-Kind', 'hospital').expect(200)
    await f.api('put', `/company-memberships/${id}/portals`).set('X-Portal-Kind', 'configuracoes').send({ allowedPortals: ['sourad'] }).expect(200)
    await api('get', '/hospital/intakes').set('X-Portal-Kind', 'hospital').expect(403)
    await api('get', '/exams').set('X-Portal-Kind', 'sourad').expect(200)
    const [event] = await f.database.query<Array<{ metadata: { allowedPortals: string } }>>("SELECT metadata FROM operational_events WHERE resource_id=$1 AND action='MEMBERSHIP_UPDATED' ORDER BY occurred_at DESC LIMIT 1", [id])
    expect(event?.metadata.allowedPortals).toBe('sourad')
  })

  it('lets a management-only manager grant another person the reporting portal without granting it to themselves', async () => {
    const { api } = await account('manager@portals.example.test', ['configuracoes'])
    await api('post', '/company-memberships').set('X-Portal-Kind', 'configuracoes').send({
      email: 'delegated@portals.example.test', fullName: 'Pessoa delegada', roleId: administratorRole, allUnits: true, unitIds: [], allowedPortals: ['sourad'],
    }).expect(201)
    const { id } = await f.exam()
    await api('get', `/exams/${id}/report`).expect(403)
    await api('get', '/exams').set('X-Portal-Kind', 'sourad').expect(403)
  })

  it('requires at least one known portal when changing access', async () => {
    const { id } = await account('validation@portals.example.test', ['sourad'])
    for (const allowedPortals of [[], ['unknown'], ['sourad', 'sourad']]) {
      await f.api('put', `/company-memberships/${id}/portals`).send({ allowedPortals }).expect(400)
    }
    await f.api('put', `/company-memberships/${id}/portals`).send({}).expect(400)
  })

  it('defaults a newly registered doctor to reporting and preserves mandatory password onboarding', async () => {
    const physician = responseBody<{ membershipId: string; initialPassword: string; allowedPortals: string[] }>(await f.api('post', '/physicians').send({ email: 'doctor@portals.example.test', name: 'Médico sintético', crm: '32199/SE', allUnits: true }).expect(201))
    expect(physician.allowedPortals).toEqual(['sourad'])
    const api = await authenticatedTestRequest(f.server, '32199SE', physician.initialPassword)
    await api('get', '/exams').set('X-Portal-Kind', 'sourad').expect(403)
    await api('put', '/auth/password').set('X-Portal-Kind', 'sourad').send({ currentPassword: physician.initialPassword, newPassword: password }).expect(200)
    await api('get', '/exams').set('X-Portal-Kind', 'sourad').expect(403)
    await api('post', '/physicians/me/signature').set('X-Portal-Kind', 'sourad').attach('signature', await syntheticSignature(), { filename: 'signature.png', contentType: 'image/png' }).expect(200)
    await api('get', '/exams').set('X-Portal-Kind', 'sourad').expect(200)
    await api('get', '/company-memberships').expect(403)
    await api('put', `/company-memberships/${physician.membershipId}/portals`).send({ allowedPortals: ['sourad', 'configuracoes'] }).expect(403)
  })
})
