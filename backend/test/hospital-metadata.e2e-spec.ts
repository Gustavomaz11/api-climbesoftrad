import { createHash } from 'node:crypto'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticDicom } from './synthetic-documents'
import { UploadSessionEntity } from '../src/database/entities/upload-session.entity'
import { ExamEntity } from '../src/database/entities/exam.entity'
import { PatientEntity } from '../src/database/entities/patient.entity'
import { ImageIngestionWorker } from '../src/modules/dicom/image-ingestion-worker.service'

interface Intake { id: string; unitId: string; studyUid: string; version: number; fields: Record<string, unknown>; issues: string[] }
describe('Hospital metadata prefill and reviewed persistence', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  beforeAll(async () => { f = await createOperationalDocumentsFixture() }, 30000)
  afterAll(async () => { await f?.app.close() })
  const stage = async (overrides: Record<string, string> = {}) => {
    const bytes = syntheticDicom({ height: '1.51', weight: '71', institution: 'Instituicao DICOM de teste', referringPhysician: 'Silva^Ana Maria', studyId: 'STUDY-123', date: '20260813', time: '113457', timezone: '', ...overrides })
    const { id } = responseBody<{ id: string }>(await f.api('post', '/uploads').send({ kind: 'DICOM', unitId: f.unit, hospitalIntake: true, name: 'metadata.dcm', contentType: 'application/dicom', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }).expect(201))
    const upload = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id })
    f.stored.set(upload.storageKey, { body: bytes, metadata: { sha256: upload.sha256 } })
    await f.database.getRepository(UploadSessionEntity).update(id, { status: 'RECEIVED' })
    await f.app.get(ImageIngestionWorker).runBatch()
    const ready = await f.database.getRepository(UploadSessionEntity).findOneByOrFail({ id })
    expect(ready.status).toBe('AWAITING_REVIEW')
    return responseBody<Intake>(await f.api('get', `/hospital/intakes/${ready.intakeId}`).expect(200))
  }
  it('prefills all requested fields while keeping Study ID distinct from UID and origin unit', async () => {
    const intake = await stage()
    expect(intake.fields).toMatchObject({ heightMeters: 1.51, weightKg: 71, studyDate: '2026-08-13', studyTime: '11:34:57', institutionName: 'Instituicao DICOM de teste', requesterName: 'Ana Maria Silva', studyId: 'STUDY-123' })
    expect(intake.fields.performedAt).toBeUndefined()
    expect(intake.unitId).toBe(f.unit)
    expect(intake.studyUid).not.toBe('STUDY-123')
    expect(intake.issues).toContain('Fuso do estudo ausente ou inválido.')
    await f.api('get', `/hospital/intakes/${intake.id}`).set('X-Unit-Id', f.secondUnit).expect(404)
  })
  it('preserves human edits and explicit clearing when more images arrive', async () => {
    const initial = await stage({ study: '1.2.826.0.1.3680043.10.900.1', instance: '1.2.826.0.1.3680043.10.901.1' })
    await f.api('patch', `/hospital/intakes/${initial.id}`).send({ expectedVersion: initial.version, fields: { heightMeters: 1.55, weightKg: null, institutionName: 'Nome conferido' } }).expect(200)
    const next = await stage({ study: '1.2.826.0.1.3680043.10.900.1', instance: '1.2.826.0.1.3680043.10.901.2', height: '1.60', weight: '80', institution: 'Nome no arquivo seguinte' })
    expect(next.fields).toMatchObject({ heightMeters: 1.55, weightKg: null, institutionName: 'Nome conferido' })
  })
  it('validates measurements and persists reviewed metadata in the published exam', async () => {
    const intake = await stage({ study: '1.2.826.0.1.3680043.10.902.1', instance: '1.2.826.0.1.3680043.10.902.2' })
    await f.api('patch', `/hospital/intakes/${intake.id}`).send({ expectedVersion: intake.version, fields: { heightMeters: -1, weightKg: '71kg' } }).expect(400)
    const sent = responseBody<{ examId: string }>(await f.api('post', `/hospital/intakes/${intake.id}/submit`).send({ expectedVersion: intake.version, fields: { ...intake.fields, socialName: 'Nome Social de Teste', performedAt: '2026-08-13T11:34:57-03:00', heightMeters: 1.55, weightKg: 70.5 } }).expect(201))
    const exam = await f.database.getRepository(ExamEntity).findOneByOrFail({ id: sent.examId })
    expect(exam).toMatchObject({ heightMeters: 1.55, weightKg: 70.5, studyDate: '2026-08-13', studyTime: '11:34:57', institutionName: 'Instituicao DICOM de teste', requesterName: 'Ana Maria Silva', studyId: 'STUDY-123', sourceExamId: intake.studyUid, unitId: f.unit })
    expect(exam).toMatchObject({ patientName: intake.fields.patientName, socialName: 'Nome Social de Teste', receivedPatientData: { fullName: intake.fields.patientName, socialName: 'Nome Social de Teste' } })
    expect(await f.database.getRepository(PatientEntity).findOneByOrFail({ id: exam.patientId })).toMatchObject({ fullName: intake.fields.patientName, socialName: 'Nome Social de Teste' })
  })
  it('leaves absent metadata empty without synthesizing patient measurements or institution', async () => {
    const intake = await stage({ study: '1.2.826.0.1.3680043.10.903.1', instance: '1.2.826.0.1.3680043.10.903.2', height: '', weight: '', institution: '', referringPhysician: '', studyId: '' })
    for (const field of ['heightMeters', 'weightKg', 'institutionName', 'requesterName', 'studyId']) expect(intake.fields).not.toHaveProperty(field)
  })
})
