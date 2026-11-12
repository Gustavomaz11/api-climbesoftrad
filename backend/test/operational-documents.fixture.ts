import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { createHash, randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import request from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { AdminAccountProvisioner } from '../src/modules/auth/admin-account.provisioner'
import { R2ObjectStorage } from '../src/modules/exams/r2-object-storage.service'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { resetCompanyTestDatabase } from './reset-company-test-database'
import { Readable } from 'node:stream'
import { R2MultipartStorage } from '../src/modules/file-validation/r2-multipart-storage.service'
import { ClamAvScanner } from '../src/modules/file-validation/clamav-scanner.service'
import { OrthancArchiveService } from '../src/modules/dicom/orthanc-archive.service'

export const responseBody = <T>(response: request.Response) => response.body as T
export const createOperationalDocumentsFixture = async (providers: {objects?:R2ObjectStorage;multipart?:R2MultipartStorage;scanner?:ClamAvScanner;archive?:OrthancArchiveService} = {}) => {
  const stored = new Map<string, { body: Buffer; metadata?: Record<string, string> }>()
  const pending = new Map<string, { key: string; sha256: string; parts: Map<number, Buffer> }>()
  const multipart = {
    begin: jest.fn((key: string, _type: string, sha256: string) => {
      const id = randomBytes(12).toString('hex')
      pending.set(id, { key, sha256, parts: new Map() })
      return Promise.resolve(id)
    }),
    signPart: jest.fn(() => Promise.resolve('https://storage.example.test/part')),
    putPart:jest.fn((_key:string,id:string,number:number,body:Buffer)=>{pending.get(id)!.parts.set(number,body);return Promise.resolve()}),
    parts: jest.fn((_key: string, id: string) =>
      Promise.resolve(
        [...pending.get(id)!.parts.entries()].map(([number, body]) => ({
          number,
          size: body.length,
          etag: `etag-${number}`,
        })),
      ),
    ),
    complete: jest.fn((key: string, id: string) => {
      const upload = pending.get(id)!
      stored.set(key, {
        body: Buffer.concat(
          [...upload.parts.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]),
        ),
        metadata: { sha256: upload.sha256 },
      })
      pending.delete(id)
      return Promise.resolve()
    }),
    abort: jest.fn((_key: string, id: string) => {
      pending.delete(id)
      return Promise.resolve()
    }),
    stream: jest.fn((key: string) => Promise.resolve(Readable.from(stored.get(key)!.body))),
  }
  const scanner = { scan: jest.fn(() => Promise.resolve('CLEAN')) }
  const archive = {
    configured: true,
    store: jest.fn(async (stream: Readable) => {
      for await (const chunk of stream) void chunk
      return randomBytes(20).toString('hex')
    }),
    request: jest.fn<Promise<Response>, [string, RequestInit?]>(),
  }
  const storage = {
    copy: jest.fn((source: string, destination: string) => {
      const object = stored.get(source)
      if (!object) return Promise.reject(new Error('SOURCE_MISSING'))
      stored.set(destination, { body: Buffer.from(object.body), metadata: object.metadata })
      return Promise.resolve()
    }),
    put: jest.fn(
      (key: string, input: { body: Buffer | string; metadata?: Record<string, string> }) => {
        stored.set(key, { body: Buffer.from(input.body), metadata: input.metadata })
        return Promise.resolve()
      },
    ),
    readText: jest.fn((key: string) => Promise.resolve(stored.get(key)?.body.toString() ?? null)),
    stat: jest.fn((key: string) =>
      Promise.resolve(
        stored.has(key)
          ? { sizeBytes: stored.get(key)!.body.length, sha256: stored.get(key)!.metadata?.sha256 }
          : null,
      ),
    ),
    signedGetUrl: jest.fn((key: string) => Promise.resolve('https://storage.example.test/' + key)),
  }
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(R2ObjectStorage)
    .useValue(providers.objects ?? storage)
    .overrideProvider(R2MultipartStorage)
    .useValue(providers.multipart ?? multipart)
    .overrideProvider(ClamAvScanner)
    .useValue(providers.scanner ?? scanner)
    .overrideProvider(OrthancArchiveService)
    .useValue(providers.archive ?? archive)
    .compile()
  const app: INestApplication = module.createNestApplication()
  app.use(cookieParser())
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  app.setGlobalPrefix('api/v1')
  await app.init()
  const database = app.get(DataSource)
  await resetCompanyTestDatabase(database)
  await app.get(AdminAccountProvisioner).ensureAdmin()
  const server = app.getHttpServer() as Server
  const config = app.get(ConfigService),
    verifier = randomBytes(64).toString('base64url')
  const login = await request(server)
    .post('/api/v1/auth/login')
    .send({
      email: config.getOrThrow<string>('ADMIN_EMAIL'),
      password: config.getOrThrow<string>('ADMIN_PASSWORD'),
      clientId: 'crm-web',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
      state: randomBytes(32).toString('base64url'),
      remember: false,
    })
    .expect(200)
  const exchange = await request(server)
    .post('/api/v1/auth/token')
    .set('Origin', 'http://localhost:5173')
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      grantType: 'authorization_code',
      clientId: 'crm-web',
      authorizationCode: responseBody<{ authorizationCode: string }>(login).authorizationCode,
      codeVerifier: verifier,
    })
    .expect(200)
  const token = responseBody<{ accessToken: string }>(exchange).accessToken
  const api = (
    method: 'get' | 'post' | 'put' | 'patch',
    path: string,
    companyId = initialCompanyId,
  ) =>
    request(server)
      [method]('/api/v1' + path)
      .set('Authorization', 'Bearer ' + token)
      .set('X-Company-Id', companyId)
  const unit = responseBody<{ id: string }>(
    await api('post', '/hospital-units').send({ name: 'Unidade Documentos' }).expect(201),
  ).id
  const secondUnit = responseBody<{ id: string }>(
    await api('post', '/hospital-units').send({ name: 'Segunda Documentos' }).expect(201),
  ).id
  const exam = async (values: Record<string, unknown> = {}) =>
    responseBody<{ id: string; patientId: string }>(
      await api('post', '/exams')
        .send({
          patientName: 'Paciente Documentos',
          sex: 'FEMININO',
          birthDate: '1990-01-01',
          country: 'Brasil',
          studyDescription: 'TC teste',
          modality: 'CT',
          unitId: unit,
          priority: 'ROTINA',
          performedAt: '2026-10-14T12:00:00Z',
          ...values,
        })
        .expect(201),
    )
  return {
    app,
    database,
    storage,
    stored,
    api,
    unit,
    secondUnit,
    exam,
    multipart,
    pending,
    scanner,
    archive,
    server,
  }
}
