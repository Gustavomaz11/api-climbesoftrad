import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { createHash, randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import request, { type Response } from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { resetCompanyTestDatabase } from './reset-company-test-database'
import { AdminAccountProvisioner } from '../src/modules/auth/admin-account.provisioner'

interface AuthorizationResponse {
  authorizationCode: string
  state: string
  expiresIn: number
}

interface TokenResponse {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

const frontendOrigin = 'http://localhost:5173'
const clientId = 'crm-web'
const primaryEmail = 'profissional@hospital.com.br'
const primaryPassword = 'uma senha hospitalar segura'

const pkceAttempt = () => {
  const verifier = randomBytes(64).toString('base64url')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'),
    state: randomBytes(32).toString('base64url'),
  }
}

const bodyAs = <Body>(response: Response): Body => response.body as Body

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')

const refreshSetCookieFrom = (response: Response): string => {
  const headers = response.headers as unknown as Record<string, unknown>
  const setCookie = headers['set-cookie']
  const firstCookie = isStringArray(setCookie) ? setCookie[0] : setCookie

  if (typeof firstCookie !== 'string') {
    throw new Error('Refresh cookie não encontrado na resposta.')
  }

  return firstCookie
}

const refreshCookieFrom = (response: Response): string =>
  refreshSetCookieFrom(response).split(';')[0] ?? refreshSetCookieFrom(response)

describe('Auth API (e2e)', () => {
  let app: INestApplication
  let server: Server
  let database: DataSource
  let hospitalUnitId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    app.setGlobalPrefix('api/v1')
    await app.init()
    server = app.getHttpServer() as Server
    database = app.get(DataSource)

    await resetCompanyTestDatabase(database)
    await app.get(AdminAccountProvisioner).ensureAdmin()
    const units = await database.query<Array<{ id: string }>>(`
      INSERT INTO hospital_units (company_id, name)
      VALUES ('00000000-0000-4000-8000-000000000001', 'Unidade Central')
      ON CONFLICT (company_id, name) DO UPDATE SET updated_at = NOW()
      RETURNING id;
    `)
    hospitalUnitId = units[0]?.id ?? ''
    await request(server).post('/api/v1/auth/register').send({
      fullName: 'Profissional Hospitalar',
      email: primaryEmail,
      password: primaryPassword,
    })
  })

  afterAll(async () => {
    await app.close()
  })

  const login = async (email = primaryEmail, password = primaryPassword) => {
    const pkce = pkceAttempt()
    const response = await request(server).post('/api/v1/auth/login').send({
      email,
      password,
      clientId,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
      state: pkce.state,
      remember: true,
    })
    return { response, pkce }
  }

  const exchange = (authorizationCode: string, codeVerifier: string) =>
    request(server)
      .post('/api/v1/auth/token')
      .set('Origin', frontendOrigin)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        grantType: 'authorization_code',
        clientId,
        authorizationCode,
        codeVerifier,
      })

  const createSession = async () => {
    const { response, pkce } = await login()
    const authorization = bodyAs<AuthorizationResponse>(response)
    const tokenResponse = await exchange(authorization.authorizationCode, pkce.verifier)
    return {
      response: tokenResponse,
      tokens: bodyAs<TokenResponse>(tokenResponse),
      cookie: refreshCookieFrom(tokenResponse),
    }
  }

  it('informa que API e PostgreSQL estão disponíveis', async () => {
    const response = await request(server).get('/api/v1/health').expect(200)
    expect(response.body).toEqual({ status: 'ok', database: 'available' })
  })

  it('registra usuário com Argon2id sem retornar password_hash', async () => {
    const email = 'novo.usuario@hospital.com.br'
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({ fullName: 'Novo Usuário', email, password: 'outra senha longa e segura' })
      .expect(201)

    expect(response.body).toMatchObject({ email, fullName: 'Novo Usuário' })
    expect(response.body).not.toHaveProperty('passwordHash')
    const rows = await database.query<Array<{ password_hash: string }>>(
      'SELECT password_hash FROM auth_users WHERE email = $1',
      [email],
    )
    expect(rows[0]?.password_hash).toContain('$argon2id$')
  })

  it('aceita senha correta e preserva state', async () => {
    const { response, pkce } = await login()
    expect(response.status).toBe(200)
    const authorization = bodyAs<AuthorizationResponse>(response)
    expect(authorization.state).toBe(pkce.state)
    expect(authorization.expiresIn).toBe(60)
  })

  it('mantém a conta administrativa ativa com papel ADMIN', async () => {
    const { response, pkce } = await login('admin@admin.com', app.get(ConfigService).getOrThrow<string>('ADMIN_PASSWORD'))
    expect(response.status).toBe(200)

    const authorization = bodyAs<AuthorizationResponse>(response)
    const tokenResponse = await exchange(authorization.authorizationCode, pkce.verifier)
    const tokens = bodyAs<TokenResponse>(tokenResponse)
    const profile = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200)

    expect(profile.body).toMatchObject({
      email: 'admin@admin.com',
      fullName: 'Administrador',
      role: 'ADMIN',
    })
  })

  it('permite ao administrador cadastrar unidades e as disponibiliza aos usuários', async () => {
    const adminLogin = await login('admin@admin.com', app.get(ConfigService).getOrThrow<string>('ADMIN_PASSWORD'))
    const adminAuthorization = bodyAs<AuthorizationResponse>(adminLogin.response)
    const adminTokenResponse = await exchange(
      adminAuthorization.authorizationCode,
      adminLogin.pkce.verifier,
    )
    const adminToken = bodyAs<TokenResponse>(adminTokenResponse).accessToken
    const unitName = `Hospital E2E ${randomBytes(6).toString('hex')}`

    const created = await request(server)
      .post('/api/v1/hospital-units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: unitName })
      .expect(201)
    expect(created.body).toMatchObject({ name: unitName, active: true })
    const createdUnitId = bodyAs<{ id: string }>(created).id

    await request(server)
      .post('/api/v1/hospital-units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: unitName.toLocaleLowerCase('pt-BR') })
      .expect(409)

    const { tokens } = await createSession()
    const userAuthorization = `Bearer ${tokens.accessToken}`
    const listed = await request(server)
      .get('/api/v1/hospital-units')
      .set('Authorization', userAuthorization)
      .expect(200)
    expect(bodyAs<Array<{ name: string }>>(listed)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: unitName })]),
    )

    await request(server)
      .post('/api/v1/hospital-units')
      .set('Authorization', userAuthorization)
      .send({ name: 'Unidade sem permissão' })
      .expect(403)

    const revoked = await request(server)
      .patch(`/api/v1/hospital-units/${createdUnitId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect(revoked.body).toMatchObject({ id: createdUnitId, active: false })

    const activeUnits = await request(server)
      .get('/api/v1/hospital-units')
      .set('Authorization', userAuthorization)
      .expect(200)
    expect(
      bodyAs<Array<{ id: string }>>(activeUnits).some((unit) => unit.id === createdUnitId),
    ).toBe(false)

    const administrativeUnits = await request(server)
      .get('/api/v1/hospital-units/admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect(bodyAs<Array<{ id: string; active: boolean }>>(administrativeUnits)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: createdUnitId, active: false })]),
    )

    const reactivated = await request(server)
      .patch(`/api/v1/hospital-units/${createdUnitId}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect(reactivated.body).toMatchObject({ id: createdUnitId, active: true })

    const selectableUnits = await request(server)
      .get('/api/v1/hospital-units')
      .set('Authorization', userAuthorization)
      .expect(200)
    expect(bodyAs<Array<{ id: string }>>(selectableUnits)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: createdUnitId })]),
    )
  })

  it('cadastra médico e exige troca da senha inicial seguida de cadastro da assinatura', async () => {
    const adminLogin = await login('admin@admin.com', app.get(ConfigService).getOrThrow<string>('ADMIN_PASSWORD'))
    const adminAuthorization = bodyAs<AuthorizationResponse>(adminLogin.response)
    const adminTokenResponse = await exchange(
      adminAuthorization.authorizationCode,
      adminLogin.pkce.verifier,
    )
    const adminToken = bodyAs<TokenResponse>(adminTokenResponse).accessToken
    const crm = 'CRM/SE 123456'
    const specialties = await request(server)
      .get('/api/v1/physicians/specialties')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const specialty = bodyAs<Array<{ id: string; name: string }>>(specialties).find(
      (item) => item.name === 'Radiologia e Diagnóstico por Imagem',
    )
    expect(bodyAs<unknown[]>(specialties)).toHaveLength(56)
    expect(specialty).toBeDefined()

    const physician = await request(server)
      .post('/api/v1/physicians')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'doctor-crm@integration.test',
        name: 'Dra. Ana Oliveira',
        specialtyId: specialty?.id,
        crm,
        allUnits: true,
        unitIds: [],
      })
      .expect(201)

    expect(physician.body).toMatchObject({
      name: 'Dra. Ana Oliveira',
      specialty: 'Radiologia e Diagnóstico por Imagem',
      crm,
      active: true,
      mustChangePassword: true,
    })

    const initialPassword = bodyAs<{ initialPassword: string }>(physician).initialPassword
    expect(initialPassword).toBe('123456SE')
    const physicianLogin = await login(crm, initialPassword)
    expect(physicianLogin.response.status).toBe(200)
    const physicianAuthorization = bodyAs<AuthorizationResponse>(physicianLogin.response)
    const physicianTokenResponse = await exchange(
      physicianAuthorization.authorizationCode,
      physicianLogin.pkce.verifier,
    )
    const physicianToken = bodyAs<TokenResponse>(physicianTokenResponse).accessToken
    const authorization = `Bearer ${physicianToken}`

    const firstProfile = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', authorization)
      .expect(200)
    expect(firstProfile.body).toMatchObject({
      username: crm,
      fullName: 'Dra. Ana Oliveira',
      role: 'DOCTOR',
      mustChangePassword: true,
      mustUploadSignature: true,
    })

    await request(server).get('/api/v1/exams').set('Authorization', authorization).expect(403)

    const changedProfile = await request(server)
      .put('/api/v1/auth/password')
      .set('Authorization', authorization)
      .send({ currentPassword: initialPassword, newPassword: 'NovaSenhaMedica21!' })
      .expect(200)
    expect(changedProfile.body).toMatchObject({
      username: crm,
      role: 'DOCTOR',
      mustChangePassword: false,
      mustUploadSignature: true,
    })

    await request(server).get('/api/v1/exams').set('Authorization', authorization).expect(403)

    expect((await login(crm, initialPassword)).response.status).toBe(401)
    expect((await login(crm, 'NovaSenhaMedica21!')).response.status).toBe(200)

    const revokedPhysician = await request(server)
      .patch(`/api/v1/physicians/${bodyAs<{ id: string }>(physician).id}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect(revokedPhysician.body).toMatchObject({
      id: bodyAs<{ id: string }>(physician).id,
      active: false,
    })

    await request(server).get('/api/v1/exams').set('Authorization', authorization).expect(403)

    const revokedLogin = await login(crm, 'NovaSenhaMedica21!')
    expect(revokedLogin.response.status).toBe(403)
    expect(bodyAs<{ message: string }>(revokedLogin.response).message).toContain('revogado')

    const reactivatedPhysician = await request(server)
      .patch(`/api/v1/physicians/${bodyAs<{ id: string }>(physician).id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect(reactivatedPhysician.body).toMatchObject({
      id: bodyAs<{ id: string }>(physician).id,
      active: true,
    })

    await request(server).get('/api/v1/exams').set('Authorization', authorization).expect(403)
    expect((await login(crm, 'NovaSenhaMedica21!')).response.status).toBe(200)
  })

  it.each([
    ['senha incorreta', primaryEmail, 'senha totalmente incorreta'],
    ['usuário inexistente', 'inexistente@hospital.com.br', primaryPassword],
  ])('retorna erro genérico para %s', async (_label, email, password) => {
    const { response } = await login(email, password)
    expect(response.status).toBe(401)
    expect(bodyAs<{ message: string }>(response).message).toBe('Usuário ou senha incorretos.')
  })

  it('rejeita usuário temporariamente bloqueado', async () => {
    await database.query(
      "UPDATE auth_users SET locked_until = NOW() + INTERVAL '10 minutes' WHERE email = $1",
      [primaryEmail],
    )
    const { response } = await login()
    expect(response.status).toBe(401)
    await database.query(
      'UPDATE auth_users SET locked_until = NULL, failed_login_attempts = 0 WHERE email = $1',
      [primaryEmail],
    )
  })

  it('rejeita PKCE plain e challenge inválido', async () => {
    const pkce = pkceAttempt()
    const basePayload = {
      email: primaryEmail,
      password: primaryPassword,
      clientId,
      state: pkce.state,
    }
    await request(server)
      .post('/api/v1/auth/login')
      .send({ ...basePayload, codeChallenge: pkce.challenge, codeChallengeMethod: 'plain' })
      .expect(400)
    await request(server)
      .post('/api/v1/auth/login')
      .send({ ...basePayload, codeChallenge: 'inválido', codeChallengeMethod: 'S256' })
      .expect(400)
  })

  it('troca authorization code com verifier correto e nunca retorna refresh em JSON', async () => {
    const { response, tokens } = await createSession()
    expect(response.status).toBe(200)
    expect(tokens.tokenType).toBe('Bearer')
    expect(tokens.accessToken.split('.')).toHaveLength(3)
    expect(response.body).not.toHaveProperty('refreshToken')
    const refreshCookie = refreshSetCookieFrom(response)
    expect(refreshCookie).toContain('crm_refresh=')
    expect(refreshCookie).toContain('HttpOnly')
    expect(refreshCookie).toContain('SameSite=Strict')
    expect(refreshCookie).toContain('Path=/')
  })

  it('rejeita verifier incorreto e registra INVALID_PKCE', async () => {
    const { response } = await login()
    const authorization = bodyAs<AuthorizationResponse>(response)
    await exchange(authorization.authorizationCode, randomBytes(64).toString('base64url')).expect(
      401,
    )
    const events = await database.query<Array<{ event_type: string }>>(
      "SELECT event_type FROM auth_security_events WHERE event_type = 'INVALID_PKCE'",
    )
    expect(events.length).toBeGreaterThan(0)
  })

  it('rejeita authorization code expirado e reutilizado', async () => {
    const expiredLogin = await login()
    const expiredCode = bodyAs<AuthorizationResponse>(expiredLogin.response).authorizationCode
    await database.query(
      "UPDATE oauth_authorization_codes SET expires_at = NOW() - INTERVAL '1 second' WHERE code_hash = $1",
      [createHash('sha256').update(expiredCode).digest('hex')],
    )
    await exchange(expiredCode, expiredLogin.pkce.verifier).expect(401)

    const validLogin = await login()
    const validCode = bodyAs<AuthorizationResponse>(validLogin.response).authorizationCode
    await exchange(validCode, validLogin.pkce.verifier).expect(200)
    await exchange(validCode, validLogin.pkce.verifier).expect(401)
  })

  it('permite somente uma troca concorrente do mesmo authorization code', async () => {
    const { response, pkce } = await login()
    const code = bodyAs<AuthorizationResponse>(response).authorizationCode
    const results = await Promise.all([
      exchange(code, pkce.verifier),
      exchange(code, pkce.verifier),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 401])
  })

  it('protege /me com JWT e retorna somente dados públicos', async () => {
    const { tokens } = await createSession()
    const response = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200)
    expect(response.body).toMatchObject({
      email: primaryEmail,
      fullName: 'Profissional Hospitalar',
    })
    expect(response.body).not.toHaveProperty('passwordHash')
  })

  it('cadastra e filtra exames em endpoint autenticado', async () => {
    const { tokens } = await createSession()
    const authorization = `Bearer ${tokens.accessToken}`
    const created = await request(server)
      .post('/api/v1/exams')
      .set('Authorization', authorization)
      .send({
        patientName: 'Maria dos Santos',
        sex: 'FEMININO',
        birthDate: '1988-05-12',
        country: 'Brasil',
        studyDescription: 'Ressonância magnética do joelho direito',
        modality: 'MR',
        unitId: hospitalUnitId,
        priority: 'ROTINA',
        performedAt: new Date().toISOString(),
      })
      .expect(201)

    expect(created.body).toMatchObject({
      patientName: 'Maria dos Santos',
      modality: 'MR',
      unit: 'Unidade Central',
    })

    const filtered = await request(server)
      .get('/api/v1/exams')
      .query({ patientName: 'maria dos', periodDays: 7, page: 1, pageSize: 10 })
      .set('Authorization', authorization)
      .expect(200)

    expect(filtered.body).toMatchObject({ total: 1, page: 1, pageSize: 10 })
    expect(bodyAs<{ items: Array<{ id: string }> }>(filtered).items[0]?.id).toBe(
      bodyAs<{ id: string }>(created).id,
    )

    const injectionAttempt = await request(server)
      .get('/api/v1/exams')
      .query({ patientName: "%' OR 1=1 --", page: 1, pageSize: 10 })
      .set('Authorization', authorization)
      .expect(200)
    expect(injectionAttempt.body).toMatchObject({ total: 0 })
  })

  it('rotaciona refresh token e detecta reutilização da família', async () => {
    const session = await createSession()
    const rotation = await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', frontendOrigin)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', session.cookie)
      .send({ grantType: 'refresh_token', clientId })
      .expect(200)
    const rotatedCookie = refreshCookieFrom(rotation)
    expect(rotatedCookie).not.toBe(session.cookie)

    await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', frontendOrigin)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', session.cookie)
      .send({ grantType: 'refresh_token', clientId })
      .expect(401)
    await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', frontendOrigin)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', rotatedCookie)
      .send({ grantType: 'refresh_token', clientId })
      .expect(401)
  })

  it('aceita somente um refresh concorrente', async () => {
    const session = await createSession()
    const refreshRequest = () =>
      request(server)
        .post('/api/v1/auth/token')
        .set('Origin', frontendOrigin)
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', session.cookie)
        .send({ grantType: 'refresh_token', clientId })
    const results = await Promise.all([refreshRequest(), refreshRequest()])
    expect(results.map((result) => result.status).sort()).toEqual([200, 401])
  })

  it('rejeita refresh expirado e revogado', async () => {
    const expired = await createSession()
    const expiredHash = createHash('sha256')
      .update(expired.cookie.split('=')[1] ?? '')
      .digest('hex')
    await database.query(
      "UPDATE auth_refresh_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1",
      [expiredHash],
    )
    await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', frontendOrigin)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', expired.cookie)
      .send({ grantType: 'refresh_token', clientId })
      .expect(401)

    const revoked = await createSession()
    const revokedHash = createHash('sha256')
      .update(revoked.cookie.split('=')[1] ?? '')
      .digest('hex')
    await database.query(
      'UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
      [revokedHash],
    )
    await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', frontendOrigin)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', revoked.cookie)
      .send({ grantType: 'refresh_token', clientId })
      .expect(401)
  })

  it('logout revoga sessão, remove cookie e invalida refresh antigo', async () => {
    const session = await createSession()
    const logout = await request(server)
      .post('/api/v1/auth/logout')
      .set('Origin', frontendOrigin)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', session.cookie)
      .expect(204)
    const headers = logout.headers as unknown as Record<string, unknown>
    expect(String(headers['set-cookie'])).toContain('crm_refresh=;')

    await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', frontendOrigin)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', session.cookie)
      .send({ grantType: 'refresh_token', clientId })
      .expect(401)
  })

  it('exige Origin autorizado em operações baseadas em cookie', async () => {
    const session = await createSession()
    await request(server)
      .post('/api/v1/auth/token')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', session.cookie)
      .send({ grantType: 'refresh_token', clientId })
      .expect(403)
  })

  it('carrega configuração de teste validada', () => {
    expect(app.get(ConfigService).get('NODE_ENV')).toBe('test')
  })

  it('rejects cookie operations without an anti-CSRF header or marked as cross-site', async () => {
    const session = await createSession()

    await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', frontendOrigin)
      .set('Cookie', session.cookie)
      .send({ grantType: 'refresh_token', clientId })
      .expect(403)

    await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', frontendOrigin)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Cookie', session.cookie)
      .send({ grantType: 'refresh_token', clientId })
      .expect(403)
  })

  it('applies global rate limiting to every endpoint', async () => {
    let limitedResponse: Response | null = null

    for (let attempt = 0; attempt < 35; attempt += 1) {
      const response = await request(server).get('/api/v1/health')
      if (response.status === 429) {
        limitedResponse = response
        break
      }
    }

    expect(limitedResponse).not.toBeNull()
    expect(limitedResponse?.headers['retry-after-burst']).toBeDefined()
    expect(limitedResponse?.body).toMatchObject({ statusCode: 429 })
  })
})
