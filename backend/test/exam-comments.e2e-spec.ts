import { ConfigService } from '@nestjs/config'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { createHash, randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import request, { type Response } from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { resetCompanyTestDatabase } from './reset-company-test-database'
import { AdminAccountProvisioner } from '../src/modules/auth/admin-account.provisioner'

interface AuthorizationResponse {
  authorizationCode: string
}

interface TokenResponse {
  accessToken: string
}

interface CommentsResponse {
  total: number
  items: Array<{
    id: string
    body: string
    authorName: string
    replies: Array<{ id: string; body: string; authorName: string }>
  }>
}

const bodyAs = <Body>(response: Response): Body => response.body as Body

describe('Exam comments API (e2e)', () => {
  let app: INestApplication
  let server: Server
  let accessToken: string
  let examId: string
  let hospitalUnitId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    app.setGlobalPrefix('api/v1')
    await app.init()
    server = app.getHttpServer() as Server

    const database = app.get(DataSource)
    await resetCompanyTestDatabase(database)
    await app.get(AdminAccountProvisioner).ensureAdmin()
    accessToken = await loginAsAdmin()
    const units = await database.query<Array<{ id: string }>>(`
      INSERT INTO hospital_units (company_id, name)
      VALUES ('00000000-0000-4000-8000-000000000001', 'Unidade Central')
      ON CONFLICT (company_id, name) DO UPDATE SET updated_at = NOW()
      RETURNING id;
    `)
    hospitalUnitId = units[0]?.id ?? ''
    examId = await createExam()
  })

  afterAll(async () => {
    await app.close()
  })

  const loginAsAdmin = async () => {
    const verifier = randomBytes(64).toString('base64url')
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@admin.com',
        password: app.get(ConfigService).getOrThrow<string>('ADMIN_PASSWORD'),
        clientId: 'crm-web',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        state: randomBytes(32).toString('base64url'),
        remember: false,
      })
    const authorization = bodyAs<AuthorizationResponse>(login)
    const exchange = await request(server)
      .post('/api/v1/auth/token')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        grantType: 'authorization_code',
        clientId: 'crm-web',
        authorizationCode: authorization.authorizationCode,
        codeVerifier: verifier,
      })
    return bodyAs<TokenResponse>(exchange).accessToken
  }

  const createExam = async () => {
    const response = await request(server)
      .post('/api/v1/exams')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        patientName: 'Paciente Comentários',
        sex: 'FEMININO',
        birthDate: '1990-01-01',
        country: 'Brasil',
        studyDescription: 'Teste de comentários',
        modality: 'MR',
        unitId: hospitalUnitId,
        priority: 'ROTINA',
        performedAt: '2026-08-23T12:00:00.000Z',
      })
      .expect(201)
    return bodyAs<{ id: string }>(response).id
  }

  it('creates a comment and a named reply and exposes the total in the exam row', async () => {
    const first = await request(server)
      .post(`/api/v1/exams/${examId}/comments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('body', 'Primeiro comentário')
      .expect(201)
    const firstBody = bodyAs<CommentsResponse>(first)
    expect(firstBody).toMatchObject({
      total: 1,
      items: [{ body: 'Primeiro comentário', authorName: 'Administrador', replies: [] }],
    })

    const rootId = firstBody.items[0]?.id
    expect(rootId).toBeDefined()
    const replied = await request(server)
      .post(`/api/v1/exams/${examId}/comments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('body', 'Resposta do comentário')
      .field('parentCommentId', rootId ?? '')
      .expect(201)
    expect(bodyAs<CommentsResponse>(replied)).toMatchObject({
      total: 2,
      items: [
        {
          authorName: 'Administrador',
          replies: [{ body: 'Resposta do comentário', authorName: 'Administrador' }],
        },
      ],
    })

    const exams = await request(server)
      .get('/api/v1/exams?page=1&pageSize=10')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
    expect(bodyAs<{ items: Array<{ id: string; commentCount: number }> }>(exams).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: examId, commentCount: 2 })]),
    )
  })
})
