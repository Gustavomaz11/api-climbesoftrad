import { OperationalAuditService } from '../src/modules/companies/operational-audit.service'
import { RejectedPatientReviewState1910000000000 } from '../src/database/migrations/1910000000000-RejectedPatientReviewState'
import { responseBody } from './operational-documents.fixture'
import { createWorkflowFixture } from './workflow.fixture'

interface Review {
  id: string
  version: number
  patientId: string
  patient: { revision: number }
}

describe('Keeping reviewed patient records separate (e2e)', () => {
  let f: Awaited<ReturnType<typeof createWorkflowFixture>>
  beforeAll(async () => { f = await createWorkflowFixture() }, 30000)
  afterAll(async () => { await f?.app.close() })

  const reject = async (patientId: string) => {
    const review = responseBody<Review[]>(await f.api('get', '/patient-reviews').expect(200))
      .find(item => item.patientId === patientId)!
    return {
      review,
      request: () => f.api('post', `/patient-reviews/${review.id}/decision`).send({
        decision: 'REJECT', expectedVersion: review.version,
        expectedSourceVersion: review.patient.revision,
        reason: 'Conferidos como pacientes distintos; manter cadastros separados.',
      }),
    }
  }

  it('clears a rejected demographic conflict without merging patients or moving the origin ID', async () => {
    const known = await f.exam({ patientName: 'Paciente Original', originIssuer: 'QA_REVIEW', externalPatientId: '0001' })
    const received = await f.exam({ patientName: 'Outro Paciente', originIssuer: 'QA_REVIEW', externalPatientId: '0001' })
    expect((await f.current(received.id)).exam.patientIdentityStatus).toBe('CONFLICT')
    const before = await f.database.query<Array<{ patient_id: string; encounter_id: string; received_patient_data: Record<string, unknown> }>>('SELECT patient_id,encounter_id,received_patient_data FROM exams WHERE id=$1', [received.id])
    const decision = await reject(received.patientId)
    await decision.request().expect(201)
    const current = await f.current(received.id)
    expect(current.exam.patientIdentityStatus).toBe('UNIDENTIFIED')
    expect(current.checklist.blockers).not.toContain('Conclua a conferência da identidade do paciente.')
    expect(await f.database.query('SELECT patient_id,encounter_id,received_patient_data FROM exams WHERE id=$1', [received.id])).toEqual(before)
    const [identifier] = await f.database.query<Array<{ patient_id: string }>>(
      "SELECT patient_id FROM patient_identifiers WHERE issuer='QA_REVIEW' AND original_value='0001'",
    )
    expect(identifier?.patient_id).toBe(known.patientId)
    expect((await f.current(known.id)).exam.patientIdentityStatus).toBe('IDENTIFIED')
    const [audit] = await f.database.query<Array<{ metadata: { reconciledExamCount: number } }>>(
      "SELECT metadata FROM operational_events WHERE action='PATIENT_MATCH_REJECTED' AND metadata->>'reviewId'=$1",
      [decision.review.id],
    )
    expect(audit?.metadata.reconciledExamCount).toBe(1)
    await f.prepare(received.id)
    expect((await f.current(received.id)).exam.workflowState).toBe('READY')
  })

  it('removes a rejected suggestion while keeping unrelated open reviews blocked', async () => {
    const known = await f.exam({ patientName: 'Paciente Sugestao QA' })
    const received = await f.exam({ patientName: 'Paciente Sugestao QA' })
    expect(received.patientId).not.toBe(known.patientId)
    expect((await f.current(received.id)).exam.patientIdentityStatus).toBe('SUGGESTION')
    const decision = await reject(received.patientId)
    await decision.request().expect(201)
    expect((await f.current(received.id)).exam.patientIdentityStatus).toBe('UNIDENTIFIED')
    const pending = await f.exam({ patientName: 'Paciente Sugestao QA' })
    expect((await f.current(pending.id)).exam.patientIdentityStatus).toBe('SUGGESTION')
  })

  it('preserves a reliable patient ID when rejecting a conflicting encounter association', async () => {
    const known = await f.exam({ patientName: 'Atendimento Original', originIssuer: 'QA_ENCOUNTER', externalPatientId: 'A', externalEncounterId: 'ATD-1' })
    const received = await f.exam({ patientName: 'Atendimento Separado', originIssuer: 'QA_ENCOUNTER', externalPatientId: 'B', externalEncounterId: 'ATD-1' })
    expect((await f.current(received.id)).exam.patientIdentityStatus).toBe('CONFLICT')
    const decision = await reject(received.patientId)
    await decision.request().expect(201)
    const current = (await f.current(received.id)).exam
    expect(current.patientIdentityStatus).toBe('IDENTIFIED')
    expect(current.patientId).toBe(received.patientId)
    expect(current.patientId).not.toBe(known.patientId)
    const [identifier] = await f.database.query<Array<{ patient_id: string; original_value: string }>>('SELECT patient_id,original_value FROM patient_identifiers WHERE id=$1', [current.patientIdentifierId])
    expect(identifier).toMatchObject({ patient_id: received.patientId, original_value: 'B' })
  })

  it('reconciles an already rejected review once, preserving new unresolved conflicts and audit evidence', async () => {
    await f.exam({ patientName: 'Paciente Historico QA' })
    const received = await f.exam({ patientName: 'Paciente Historico QA' })
    const decision = await reject(received.patientId)
    await decision.request().expect(201)
    await f.database.query("UPDATE exams SET patient_identity_status='SUGGESTION' WHERE id=$1", [received.id])
    const pending = await f.exam({ patientName: 'Paciente Historico QA' })
    const later = await f.exam({ patientId: received.patientId, patientName: 'Paciente Historico QA' })
    await f.database.query("UPDATE exams SET patient_identity_status='SUGGESTION',created_at=(SELECT updated_at+interval '1 second' FROM patient_reviews WHERE id=$2) WHERE id=$1", [later.id, decision.review.id])
    const runner = f.database.createQueryRunner()
    try {
      await new RejectedPatientReviewState1910000000000().up(runner)
      await new RejectedPatientReviewState1910000000000().up(runner)
    } finally { await runner.release() }
    expect((await f.current(received.id)).exam.patientIdentityStatus).toBe('UNIDENTIFIED')
    expect((await f.current(pending.id)).exam.patientIdentityStatus).toBe('SUGGESTION')
    expect((await f.current(later.id)).exam.patientIdentityStatus).toBe('SUGGESTION')
    const [audit] = await f.database.query<Array<{ count: number }>>(
      "SELECT COUNT(*)::int AS count FROM operational_events WHERE resource_id=$1 AND metadata->>'origin'='MIGRATION'",
      [received.id],
    )
    expect(audit?.count).toBe(1)
  })

  it('keeps preparation blocked until all open identity reviews in the unit are decided', async () => {
    await f.exam({ patientName: 'Paciente Multiplas QA' })
    const received = await f.exam({ patientName: 'Paciente Multiplas QA' })
    const decision = await reject(received.patientId)
    await f.database.query(`INSERT INTO patient_reviews(company_id,unit_id,patient_id,exam_id,kind,status,version,candidates,differences)
      SELECT company_id,unit_id,patient_id,exam_id,'CONFLICT','OPEN',0,'[]','[]' FROM patient_reviews WHERE id=$1`, [decision.review.id])
    await decision.request().expect(201)
    expect((await f.current(received.id)).checklist.blockers).toContain('Conclua a conferência da identidade do paciente.')
    const remaining = await reject(received.patientId)
    await remaining.request().expect(201)
    expect((await f.current(received.id)).exam.patientIdentityStatus).toBe('UNIDENTIFIED')
  })

  it('rolls back the review and identity change when the audit cannot be recorded', async () => {
    await f.exam({ patientName: 'Paciente Rollback QA' })
    const received = await f.exam({ patientName: 'Paciente Rollback QA' })
    const decision = await reject(received.patientId)
    const audit = jest.spyOn(f.app.get(OperationalAuditService), 'record').mockRejectedValueOnce(new Error('Audit unavailable'))
    try { await decision.request().expect(500) } finally { audit.mockRestore() }
    expect((await f.current(received.id)).exam.patientIdentityStatus).toBe('SUGGESTION')
    const [review] = await f.database.query<Array<{ status: string }>>('SELECT status FROM patient_reviews WHERE id=$1', [decision.review.id])
    expect(review?.status).toBe('OPEN')
  })
})
