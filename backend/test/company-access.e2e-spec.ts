import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import request, { type Response } from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { AdminAccountProvisioner } from '../src/modules/auth/admin-account.provisioner'
import { OperationalAuditService } from '../src/modules/companies/operational-audit.service'
import { R2ObjectStorage } from '../src/modules/exams/r2-object-storage.service'
import { resetCompanyTestDatabase } from './reset-company-test-database'
import { ClamAvScanner } from '../src/modules/file-validation/clamav-scanner.service'
import { syntheticSignature } from './synthetic-signature'

const bodyAs = <T>(response: Response) => response.body as T
interface Provisioned {
  id: string
  userId: string
  initialPassword: string | null
  existingIdentity: boolean
}
interface Role {
  id: string
  code: string
  permissions: string[]
}
const password = 'Senha de integração segura 2026!'
const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Documento de teste' }] }],
}

describe('Companies and unit isolation (e2e)', () => {
  let app: INestApplication
  let server: Server
  let database: DataSource
  let root: string
  let companyB: string
  let unitA: string
  let unitA2: string
  let unitB: string
  let examA: string
  let examA2: string
  let examB: string
  let rolesA: Role[]
  let rolesB: Role[]
  let shared: Provisioned
  let sharedToken: string
  const objects = new Map<string, string>()
  const storage = {
    readText: jest.fn((key: string) => Promise.resolve(objects.get(key) ?? null)),
    put: jest.fn((key: string, input: { body: string | Buffer }) => {
      objects.set(key, input.body.toString())
      return Promise.resolve()
    }),
    delete: jest.fn((key: string) => {
      objects.delete(key)
      return Promise.resolve()
    }),
    signedGetUrl: jest.fn((key: string) =>
      Promise.resolve('https://storage.example.test/' + encodeURIComponent(key)),
    ),
  }
  const api = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    token = root,
    company = initialCompanyId,
  ) =>
    request(server)
      [method]('/api/v1' + path)
      .set('Authorization', 'Bearer ' + token)
      .set('X-Company-Id', company)
  const role = (items: Role[], code: string) => {
    const found = items.find((item) => item.code === code)
    if (!found) throw new Error('Cargo ausente: ' + code)
    return found.id
  }
  const login = async (email: string, currentPassword: string) => {
    const verifier = randomBytes(64).toString('base64url')
    const authorization = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email,
        password: currentPassword,
        clientId: 'crm-web',
        remember: false,
        codeChallenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'),
        codeChallengeMethod: 'S256',
        state: randomBytes(32).toString('base64url'),
      })
      .expect(200)
    const exchanged = await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        grantType: 'authorization_code',
        clientId: 'crm-web',
        authorizationCode: bodyAs<{ authorizationCode: string }>(authorization).authorizationCode,
        codeVerifier: verifier,
      })
      .expect(200)
    return bodyAs<{ accessToken: string }>(exchanged).accessToken
  }
  const provision = async (
    email: string,
    roleId: string,
    company = initialCompanyId,
    unitIds = [unitA, unitA2],
    allUnits = false,
  ) =>
    bodyAs<Provisioned>(
      await api('post', '/company-memberships', root, company)
        .send({
          email,
          fullName: 'Usuário de Integração',
          roleId,
          allUnits,
          unitIds,
        })
        .expect(201),
    )
  const exam = async (unitId: string, company: string) =>
    bodyAs<{ id: string }>(
      await api('post', '/exams', root, company)
        .send({
          patientName: 'Paciente de Teste',
          sex: 'FEMININO',
          birthDate: '1990-01-01',
          country: 'Brasil',
          studyDescription: 'Estudo de teste',
          modality: 'CT',
          unitId,
          priority: 'ROTINA',
          performedAt: '2026-10-13T12:00:00Z',
        })
        .expect(201),
    ).id
  const changeInitialPassword = (token: string, initial: string, company = initialCompanyId) =>
    api('put', '/auth/password', token, company)
      .send({ currentPassword: initial, newPassword: password })
      .expect(200)

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2ObjectStorage)
      .useValue(storage)
      .overrideProvider(ClamAvScanner)
      .useValue({ scan: () => Promise.resolve('CLEAN') })
      .compile()
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    app.setGlobalPrefix('api/v1')
    await app.init()
    server = app.getHttpServer() as Server
    database = app.get(DataSource)
    await resetCompanyTestDatabase(database)
    await app.get(AdminAccountProvisioner).ensureAdmin()
    const config = app.get(ConfigService)
    root = await login(
      config.getOrThrow<string>('ADMIN_EMAIL'),
      config.getOrThrow<string>('ADMIN_PASSWORD'),
    )
    companyB = bodyAs<{ id: string }>(
      await api('post', '/companies').send({ name: 'Empresa B de Teste' }).expect(201),
    ).id
    unitA = bodyAs<{ id: string }>(
      await api('post', '/hospital-units').send({ name: 'Central' }).expect(201),
    ).id
    unitA2 = bodyAs<{ id: string }>(
      await api('post', '/hospital-units').send({ name: 'Segunda' }).expect(201),
    ).id
    unitB = bodyAs<{ id: string }>(
      await api('post', '/hospital-units', root, companyB).send({ name: 'Central' }).expect(201),
    ).id
    rolesA = bodyAs<Role[]>(await api('get', '/access-control/roles').expect(200))
    rolesB = bodyAs<Role[]>(await api('get', '/access-control/roles', root, companyB).expect(200))
    examA = await exam(unitA, initialCompanyId)
    examA2 = await exam(unitA2, initialCompanyId)
    examB = await exam(unitB, companyB)
    shared = await provision('shared@integration.test', role(rolesA, 'ADMINISTRATOR'))
    sharedToken = await login('shared@integration.test', shared.initialPassword ?? '')
    await changeInitialPassword(sharedToken, shared.initialPassword ?? '')
  }, 30000)
  afterAll(async () => {
    await app?.close()
  })

  it('preserva o isolamento legado e usa a central SouRad automaticamente', async () => {
    expect(unitA).not.toBe(unitB)
    const automatic = bodyAs<{items:Array<{id:string}>}>(await request(server)
      .get('/api/v1/exams')
      .set('Authorization', 'Bearer ' + root)
      .expect(200))
    expect(automatic.items.map(item=>item.id).sort()).toEqual([examA,examA2].sort())
    const list = bodyAs<{ items: Array<{ id: string }>; total: number }>(
      await api('get', '/exams').expect(200),
    )
    expect(list.items.map((item) => item.id).sort()).toEqual([examA, examA2].sort())
    const other = bodyAs<{ items: Array<{ id: string }> }>(
      await api('get', '/exams', root, companyB).expect(200),
    )
    expect(other.items.map((item) => item.id)).toEqual([examB])
  })

  it('exige troca inicial e reutiliza identidade sem alterar nome, senha ou poderes em outra empresa', async () => {
    const pending = await provision('pending@integration.test', role(rolesA, 'READ_ONLY'))
    const token = await login('pending@integration.test', pending.initialPassword ?? '')
    await api('get', '/exams', token).expect(403)
    await changeInitialPassword(token, pending.initialPassword ?? '')
    await api('get', '/exams', token).expect(200)
    const linked = await provision('shared@integration.test', role(rolesB, 'READ_ONLY'), companyB, [
      unitB,
    ])
    expect(linked).toMatchObject({
      userId: shared.userId,
      initialPassword: null,
      existingIdentity: true,
    })
    const meA = bodyAs<{ accessRole: { code: string }; companies: Array<{ id: string }> }>(
      await api('get', '/auth/me', sharedToken).expect(200),
    )
    const meB = bodyAs<{ accessRole: { code: string } }>(
      await api('get', '/auth/me', sharedToken, companyB).expect(200),
    )
    expect(meA.accessRole.code).toBe('ADMINISTRATOR')
    expect(meB.accessRole.code).toBe('READ_ONLY')
    expect(meA.companies.map((item) => item.id)).toEqual(
      expect.arrayContaining([initialCompanyId, companyB]),
    )
    await api('post', '/exams', sharedToken, companyB).send({}).expect(403)
    await login('shared@integration.test', password)
  })

  it('bloqueia leitura, escrita, anexos e presença cruzados antes de chamar armazenamento', async () => {
    jest.clearAllMocks()
    for (const suffix of ['/report', '/prescription', '/comments'])
      await api('get', '/exams/' + examB + suffix).expect(404)
    for (const suffix of ['/report', '/prescription', '/prescription/sign'])
      await api('put', '/exams/' + examB + suffix)
        .send({ content })
        .expect(404)
    await api('put', '/exams/' + examB + '/report/presence/' + randomUUID()).expect(404)
    await api('post', '/exams/' + examB + '/comments')
      .field('body', 'Texto de teste')
      .expect(404)
    const image = Buffer.from('89504e470d0a1a0a00000000', 'hex')
    for (const suffix of ['/report/images', '/prescription/images'])
      await api('post', '/exams/' + examB + suffix)
        .attach('file', image, { filename: 'teste.png', contentType: 'image/png' })
        .expect(404)
    expect(storage.readText).not.toHaveBeenCalled()
    expect(storage.put).not.toHaveBeenCalled()
    expect(storage.signedGetUrl).not.toHaveBeenCalled()
    await api('get', '/hospital-units', root, initialCompanyId).set('X-Unit-Id', unitB).expect(404)
  })

  it('impede referências cruzadas também pelas restrições do PostgreSQL', async () => {
    await expect(
      database.query('UPDATE exams SET company_id = $1 WHERE id = $2', [companyB, examA]),
    ).rejects.toMatchObject({ driverError: { code: '23503' } })
    await expect(
      database.query('UPDATE company_memberships SET access_role_id = $1 WHERE id = $2', [
        role(rolesB, 'READ_ONLY'),
        shared.id,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23503' } })
    await expect(
      database.query(
        'INSERT INTO company_membership_units(membership_id, company_id, unit_id) VALUES ($1,$2,$3)',
        [shared.id, initialCompanyId, unitB],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23503' } })
  })

  it('revoga unidade e empresa sem invalidar sessão nem histórico das demais', async () => {
    const clientA = randomUUID()
    const clientA2 = randomUUID()
    await api('put', '/exams/' + examA + '/report/presence/' + clientA, sharedToken).expect(200)
    await api('put', '/exams/' + examA2 + '/report/presence/' + clientA2, sharedToken).expect(200)
    await api('put', '/company-memberships/' + shared.id + '/units')
      .send({ allUnits: false, unitIds: [unitA] })
      .expect(200)
    await api('get', '/exams/' + examA2 + '/report', sharedToken).expect(404)
    await api('get', '/exams/' + examA + '/report', sharedToken).expect(200)
    const presence = await database.query<Array<{ exam_id: string }>>(
      'SELECT exam_id FROM exam_report_presences WHERE user_id = $1',
      [shared.userId],
    )
    expect(presence.map((item) => item.exam_id)).toEqual([examA])
    await api('patch', '/company-memberships/' + shared.id + '/status')
      .send({ active: false, reason: 'Fim do vínculo de teste' })
      .expect(200)
    await api('get', '/exams', sharedToken).expect(403)
    await api('get', '/exams', sharedToken, companyB).expect(200)
    expect(
      await database.query<Array<{ id: string }>>('SELECT id FROM exams WHERE id = $1', [examA]),
    ).toHaveLength(1)
    await login('shared@integration.test', password)
    await api('patch', '/company-memberships/' + shared.id + '/status')
      .send({ active: true })
      .expect(200)
  })

  it('consulta vínculos nas duas direções sem vazar unidades fora do escopo', async () => {
    const all = bodyAs<Array<{ id: string; unitIds: string[] }>>(
      await api('get', '/company-memberships').expect(200),
    )
    expect(all.find((item) => item.id === shared.id)?.unitIds).toEqual([unitA])
    const units = bodyAs<Array<{ id: string }>>(
      await api('get', '/hospital-units', sharedToken).expect(200),
    )
    expect(units.map((item) => item.id)).toEqual([unitA])
    const scoped = bodyAs<Array<{ unitIds: string[] }>>(
      await api('get', '/company-memberships', root).set('X-Unit-Id', unitA).expect(200),
    )
    expect(scoped.every((item) => item.unitIds.every((id) => id === unitA))).toBe(true)
  })

  it('cargo inativo em A não impede autenticação ou operação em B', async () => {
    const custom = bodyAs<{ id: string }>(
      await api('post', '/access-control/roles')
        .send({
          name: 'Cargo Temporário',
          description: 'Teste',
          permissionCodes: ['companies.view', 'exams.view'],
        })
        .expect(201),
    )
    await api('patch', '/access-control/users/' + shared.userId + '/role')
      .send({ roleId: custom.id })
      .expect(200)
    await api('patch', '/access-control/roles/' + custom.id + '/revoke').expect(200)
    await api('get', '/exams', sharedToken).expect(403)
    await api('get', '/exams', sharedToken, companyB).expect(200)
    await login('shared@integration.test', password)
    await api('patch', '/access-control/roles/' + custom.id + '/reactivate').expect(200)
    await api('patch', '/access-control/users/' + shared.userId + '/role')
      .send({ roleId: role(rolesA, 'ADMINISTRATOR') })
      .expect(200)
  })

  it('administração local não cria empresas nem amplia seus próprios poderes ou unidades', async () => {
    await api('put', '/companies/' + initialCompanyId, sharedToken)
      .send({ name: 'Renomeação fora do escopo' })
      .expect(403)
    await api('post', '/companies', sharedToken).send({ name: 'Sem Permissão' }).expect(403)
    await api('patch', '/companies/' + companyB + '/status', sharedToken)
      .send({ active: false })
      .expect(403)
    await api('post', '/company-memberships', sharedToken)
      .send({
        email: 'outside@integration.test',
        fullName: 'Teste',
        roleId: role(rolesA, 'READ_ONLY'),
        allUnits: false,
        unitIds: [unitA2],
      })
      .expect(404)
    await api('post', '/company-memberships', sharedToken)
      .send({
        email: 'all@integration.test',
        fullName: 'Teste',
        roleId: role(rolesA, 'READ_ONLY'),
        allUnits: true,
        unitIds: [],
      })
      .expect(403)
    const limited = bodyAs<{ id: string }>(
      await api('post', '/access-control/roles')
        .send({
          name: 'Gestor Limitado',
          permissionCodes: ['roles.create', 'roles.permissions.manage', 'companies.view'],
        })
        .expect(201),
    )
    const manager = await provision('limited@integration.test', limited.id)
    const token = await login('limited@integration.test', manager.initialPassword ?? '')
    await changeInitialPassword(token, manager.initialPassword ?? '')
    await api('post', '/access-control/roles', token)
      .send({ name: 'Escalada', permissionCodes: ['users.roles.assign'] })
      .expect(403)
  })

  it('impede que um administrador de unidade altere cargos utilizados fora de seu escopo', async () => {
    const custom = bodyAs<{ id: string }>(
      await api('post', '/access-control/roles')
        .send({ name: 'Cargo Compartilhado', permissionCodes: ['exams.view'] })
        .expect(201),
    )
    await provision('other-unit@integration.test', custom.id, initialCompanyId, [unitA2])
    await api('patch', '/access-control/roles/' + custom.id + '/revoke', sharedToken).expect(403)
    await api('put', '/access-control/roles/' + custom.id, sharedToken)
      .send({ name: 'Mudança Indevida', permissionCodes: [] })
      .expect(403)
  })

  it('mantém revisões de apresentação, precedência e preferências separadas por empresa', async () => {
    await api('put', '/company-settings')
      .send({
        expectedVersion: 0,
        presentation: {
          headerText: 'Cabeçalho A',
          footerText: 'Rodapé A',
          signatureText: 'Assinatura A',
        },
      })
      .expect(200)
    await api('put', '/company-settings').send({ expectedVersion: 0, presentation: {} }).expect(409)
    await api('put', '/company-settings')
      .send({ unitId: unitA, expectedVersion: 0, presentation: { headerText: 'Unidade A' } })
      .expect(200)
    await api('put', '/company-memberships/' + shared.id + '/preferences', sharedToken)
      .send({ expectedVersion: 0, signatureText: 'Preferência A' })
      .expect(200)
    const a = bodyAs<{ presentation: object }>(
      await api('get', '/exams/' + examA + '/report', sharedToken).expect(200),
    )
    expect(a.presentation).toMatchObject({
      headerText: 'Unidade A',
      footerText: 'Rodapé A',
      signatureText: 'Preferência A',
    })
    const b = bodyAs<{ presentation: object }>(
      await api('get', '/exams/' + examB + '/report', sharedToken, companyB).expect(200),
    )
    expect(b.presentation).toMatchObject({ headerText: '', footerText: '', signatureText: '' })
    await api('put', '/company-settings')
      .send({ unitId: unitB, expectedVersion: 0, presentation: {} })
      .expect(404)
  })

  it('preserva a apresentação da prescrição assinada após alterar configurações', async () => {
    const [specialty] = await database.query<Array<{ id: string }>>(
      'SELECT id FROM medical_specialties LIMIT 1',
    )
    if (!specialty) throw new Error('Especialidade de teste ausente.')
    const physician = bodyAs<Provisioned>(
      await api('post', '/physicians')
        .send({ email: 'doctor-teste5678@integration.test',
          name: 'Médica de Teste',
          crm: 'TESTE-5678',
          specialtyId: specialty.id,
          allUnits: false,
          unitIds: [unitA],
        })
        .expect(201),
    )
    const [identity] = await database.query<Array<{ username: string }>>(
      'SELECT username FROM auth_users WHERE id = $1',
      [physician.userId],
    )
    if (!identity) throw new Error('Identidade médica de teste ausente.')
    const token = await login(identity.username, physician.initialPassword ?? '')
    await changeInitialPassword(token, physician.initialPassword ?? '')
    await api('post', '/physicians/me/signature', token)
      .attach('signature', await syntheticSignature(), { filename: 'signature.png', contentType: 'image/png' }).expect(200)
    const signed = bodyAs<{ presentation: object }>(
      await api('put', '/exams/' + examA + '/prescription/sign', token)
        .send({ content })
        .expect(200),
    )
    await api('put', '/company-settings')
      .send({ unitId: unitA, expectedVersion: 1, presentation: { headerText: 'Novo Cabeçalho' } })
      .expect(200)
    const fetched = bodyAs<{ presentation: object }>(
      await api('get', '/exams/' + examA + '/prescription', token).expect(200),
    )
    expect(fetched.presentation).toEqual(signed.presentation)
    expect(fetched.presentation).toMatchObject({ headerText: 'Unidade A' })
    const linked = bodyAs<Provisioned>(
      await api('post', '/physicians', root, companyB)
        .send({ email: 'doctor-teste5678@integration.test',
          name: 'Nome que não altera identidade',
          crm: 'TESTE-5678',
          specialtyId: specialty.id,
          allUnits: false,
          unitIds: [unitB],
        })
        .expect(201),
    )
    expect(linked).toMatchObject({
      userId: physician.userId,
      initialPassword: null,
      existingIdentity: true,
    })
    const profiles = bodyAs<Array<{ id: string; userId: string; name: string }>>(
      await api('get', '/physicians').expect(200),
    )
    const profile = profiles.find((item) => item.userId === physician.userId)
    if (!profile) throw new Error('Perfil de teste ausente.')
    await api('patch', '/physicians/' + profile.id + '/revoke').expect(200)
    await api('get', '/exams', token).expect(403)
    await api('get', '/exams', token, companyB).expect(200)
    expect(
      bodyAs<Array<{ name: string }>>(
        await api('get', '/physicians', root, companyB).expect(200),
      ).map((item) => item.name),
    ).toContain('Médica de Teste')
  })

  it('audita anexos do comentário e compensa armazenamento quando a transação é revertida', async () => {
    const before = [...objects.keys()]
      .filter((key) => key.startsWith('comments/' + examA + '/'))
      .sort()
    const audit = app.get(OperationalAuditService)
    const failure = jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('Falha transacional de comentário'))
    try {
      await api('post', '/exams/' + examA + '/comments')
        .field('body', 'Comentário a reverter')
        .attach('attachments', Buffer.from('Arquivo de teste'), {
          filename: 'teste.txt',
          contentType: 'text/plain',
        })
        .expect(500)
    } finally {
      failure.mockRestore()
    }
    expect(
      [...objects.keys()].filter((key) => key.startsWith('comments/' + examA + '/')).sort(),
    ).toEqual(before)
    expect(
      await database.query<Array<{ id: string }>>(
        "SELECT id FROM exam_comments WHERE body = 'Comentário a reverter'",
      ),
    ).toHaveLength(0)
    const events = await database.query<Array<{ action: string; outcome: string }>>(
      "SELECT action, outcome FROM operational_events WHERE resource_id = $1 AND action LIKE 'COMMENT_ATTACHMENT_%' ORDER BY occurred_at",
      [examA],
    )
    expect(events).toEqual([
      { action: 'COMMENT_ATTACHMENT_UPLOADED', outcome: 'SUCCEEDED' },
      { action: 'COMMENT_ATTACHMENT_REMOVED', outcome: 'SUCCEEDED' },
    ])
  })

  it('confirma cadastro e intenção do anexo sem copiar texto clínico para a auditoria', async () => {
    await api('post', '/exams/' + examA + '/comments')
      .field('body', 'Comentário de teste')
      .attach('attachments', Buffer.from('Arquivo de teste'), {
        filename: 'teste.txt',
        contentType: 'text/plain',
      })
      .expect(201)
    const events = await database.query<Array<{ metadata: Record<string, unknown> }>>(
      "SELECT metadata FROM operational_events WHERE resource_id = $1 AND action = 'COMMENT_ATTACHMENT_UPLOADED' AND outcome = 'SUCCEEDED'",
      [examA],
    )
    expect(
      events.some(
        (event) =>
          typeof event.metadata.storageKey === 'string' &&
          typeof event.metadata.payloadHash === 'string',
      ),
    ).toBe(true)
  })

  it('grava auditoria com ator, sessão, empresa e correlação, sem senha ou conteúdo clínico', async () => {
    const events = await database.query<
      Array<{
        action: string
        company_id: string
        actor_user_id: string
        session_id: string
        correlation_id: string
        metadata: Record<string, unknown>
      }>
    >('SELECT * FROM operational_events WHERE company_id = $1', [initialCompanyId])
    expect(events.some((event) => event.action === 'PRESCRIPTION_SIGNED')).toBe(true)
    expect(
      events.every((event) => event.actor_user_id && event.session_id && event.correlation_id),
    ).toBe(true)
    expect(
      events.every((event) => !('password' in event.metadata) && !('content' in event.metadata)),
    ).toBe(true)
    const before = await database.query<Array<{ count: string }>>(
      'SELECT COUNT(*)::text AS count FROM hospital_units',
    )
    const audit = app.get(OperationalAuditService)
    const failure = jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('Falha simulada de auditoria'))
    await api('post', '/hospital-units').send({ name: 'Deve Reverter' }).expect(500)
    failure.mockRestore()
    const after = await database.query<Array<{ count: string }>>(
      'SELECT COUNT(*)::text AS count FROM hospital_units',
    )
    expect(after).toEqual(before)
    expect(
      await database.query<Array<{ id: string }>>(
        "SELECT id FROM hospital_units WHERE name = 'Deve Reverter'",
      ),
    ).toHaveLength(0)
  })

  it('rejeita nomes vazios depois da normalização', async () => {
    await api('post', '/companies').send({ name: '   ' }).expect(400)
    await api('post', '/hospital-units').send({ name: '   ' }).expect(400)
    await api('post', '/company-memberships')
      .send({
        email: 'blank@integration.test',
        fullName: '  ',
        roleId: role(rolesA, 'READ_ONLY'),
        allUnits: false,
        unitIds: [unitA],
      })
      .expect(400)
  })
})
