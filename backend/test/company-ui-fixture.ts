// Local browser QA only: synthetic data, _test database and in-memory object storage.
import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import type { Request, Response } from 'express'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module'
import { AuthUserEntity } from '../src/database/entities/auth-user.entity'
import { AccessRoleEntity } from '../src/database/entities/access-role.entity'
import { CompanyEntity } from '../src/database/entities/company.entity'
import { CompanyMembershipEntity } from '../src/database/entities/company-membership.entity'
import { HospitalUnitEntity } from '../src/database/entities/hospital-unit.entity'
import { PatientEntity } from '../src/database/entities/patient.entity'
import { PatientUnitEntity } from '../src/database/entities/patient-unit.entity'
import { PatientEncounterEntity } from '../src/database/entities/patient-encounter.entity'
import { PatientReviewEntity } from '../src/database/entities/patient-review.entity'
import { ExamEntity } from '../src/database/entities/exam.entity'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { CryptoService } from '../src/modules/auth/crypto.service'
import { seedCompanyRoles } from '../src/modules/companies/company-default-roles'
import { R2ObjectStorage } from '../src/modules/exams/r2-object-storage.service'
import { resetCompanyTestDatabase } from './reset-company-test-database'

async function start() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Fixture requires NODE_ENV=test.')
  const objects = new Map<string, { body: Buffer; contentType: string; metadata?: Record<string, string> }>()
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(R2ObjectStorage)
    .useValue({
      readText: (key: string) => Promise.resolve(objects.get(key)?.body.toString() ?? null),
      put: (key: string, input: { body: string | Buffer; contentType: string; metadata?: Record<string, string> }) => {
        objects.set(key, { body: Buffer.from(input.body), contentType: input.contentType, metadata: input.metadata })
        return Promise.resolve()
      },
      delete: (key: string) => {
        objects.delete(key)
        return Promise.resolve()
      },
      stat: (key: string) => Promise.resolve(objects.has(key) ? { sizeBytes: objects.get(key)!.body.length, sha256: objects.get(key)!.metadata?.sha256 } : null),
      signedGetUrl: (key: string) =>
        Promise.resolve('http://localhost:5174/qa-objects/' + encodeURIComponent(key)),
    })
    .compile()
  const app = moduleRef.createNestApplication()
  const database = app.get(DataSource)
  await resetCompanyTestDatabase(database)
  const companies = database.getRepository(CompanyEntity)
  const other = await companies.save(companies.create({ name: 'Clínica de Teste B', active: true }))
  await seedCompanyRoles(database.manager, other.id)
  const roles = database.getRepository(AccessRoleEntity)
  const administrator = await roles.findOneByOrFail({
    companyId: initialCompanyId,
    code: 'ADMINISTRATOR',
  })
  const reader = await roles.findOneByOrFail({ companyId: other.id, code: 'READ_ONLY' })
  const passwordHash = await app.get(CryptoService).hashPassword('Senha UI de teste 2026!')
  const users = database.getRepository(AuthUserEntity)
  const operator = await users.save(
    users.create({
      email: 'ui.operator@sourad.test',
      fullName: 'Operador de Teste',
      passwordHash,
      role: 'USER',
      status: 'ACTIVE',
      accessRoleId: administrator.id,
      mustChangePassword: false,
    }),
  )
  await database.getRepository(CompanyMembershipEntity).save([
    {
      companyId: initialCompanyId,
      userId: operator.id,
      accessRoleId: administrator.id,
      active: true,
      allUnits: true,
    },
    {
      companyId: other.id,
      userId: operator.id,
      accessRoleId: reader.id,
      active: true,
      allUnits: true,
    },
  ])
  const units = database.getRepository(HospitalUnitEntity)
  for (const [companyId, label] of [
    [initialCompanyId, 'A'],
    [other.id, 'B'],
  ] as const) {
    const unit = await units.save(
      units.create({ companyId, name: 'Central ' + label, active: true }),
    )
    const patient = await database.getRepository(PatientEntity).save({
      companyId,
      fullName: 'Paciente de Teste ' + label,
      normalizedName: 'paciente de teste ' + label.toLowerCase(),
      sex: 'FEMININO',
      birthDate: '1990-01-01',
      country: 'Brasil',
      revision: 0,
    })
    await database
      .getRepository(PatientUnitEntity)
      .save({ companyId, unitId: unit.id, patientId: patient.id })
    const encounter = await database
      .getRepository(PatientEncounterEntity)
      .save({ companyId, unitId: unit.id, patientId: patient.id, performedAt: new Date() })
    const exam = await database.getRepository(ExamEntity).save({
      patientId: patient.id,
      encounterId: encounter.id,
      patientIdentityStatus: 'LEGACY',
      normalizationStatus: 'UNKNOWN',
      receivedPatientData: {
        fullName: patient.fullName,
        birthDate: patient.birthDate,
        sex: patient.sex,
        country: patient.country,
      },
      companyId,
      unitId: unit.id,
      patientName: 'Paciente de Teste ' + label,
      sex: 'FEMININO',
      birthDate: '1990-01-01',
      country: 'Brasil',
      studyDescription: 'Estudo de teste ' + label,
      modality: 'CT',
      priority: 'ROTINA',
      performedAt: new Date(),
      createdByUserId: operator.id,
    })
    await database.getRepository(PatientReviewEntity).save({
      companyId,
      unitId: unit.id,
      patientId: patient.id,
      examId: exam.id,
      kind: 'LEGACY',
      status: 'OPEN',
      version: 0,
      candidates: [],
      differences: [],
    })
  }
  app.use(cookieParser())
  app.use('/qa-objects', (req: Request, res: Response) => {
    const object = objects.get(decodeURIComponent(req.path.slice(1)))
    if (!object) { res.sendStatus(404); return }
    res.setHeader('Content-Type', object.contentType)
    res.setHeader('Cache-Control', 'no-store')
    res.send(object.body)
  })
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  app.setGlobalPrefix('api/v1')
  app.enableCors({
    origin: 'http://localhost:5174',
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Company-Id',
      'X-Unit-Id',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
  await app.listen(3301, '127.0.0.1')
  console.log('Synthetic UI fixture ready on port 3301.')
  process.on('SIGINT', () => {
    void app.close().then(() => process.exit(0))
  })
}
void start().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
