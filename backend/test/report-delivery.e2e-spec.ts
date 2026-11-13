import { randomUUID } from 'node:crypto'
import { createWorkflowFixture } from './workflow.fixture'
import { authenticatedTestRequest } from './authenticated-test-request'
import { responseBody } from './operational-documents.fixture'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import { OperationalAuditService } from '../src/modules/companies/operational-audit.service'
import { syntheticSignature } from './synthetic-signature'
import { getStorageToken } from '@nestjs/throttler'

describe('Doctor completion and explicit return to the origin hospital', () => {
  let f: Awaited<ReturnType<typeof createWorkflowFixture>>
  let doctor: Awaited<ReturnType<typeof authenticatedTestRequest>>
  let hospital: Awaited<ReturnType<typeof authenticatedTestRequest>>
  let signatureId: string
  let secondDoctor: Awaited<ReturnType<typeof authenticatedTestRequest>>
  let doctorId: string
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Laudo sintético concluído para teste de entrega.' }] }] }
  beforeAll(async () => {
    f = await createWorkflowFixture()
    const physician = responseBody<{ initialPassword: string }>(await f.api('post', '/physicians').send({ email: 'doctor-87654se@integration.test', name: 'Médico sintético', crm: '87654/SE', allUnits: true }).expect(201))
    doctor = await authenticatedTestRequest(f.server, '87654/SE', physician.initialPassword)
    await doctor('put', '/auth/password').send({ currentPassword: physician.initialPassword, newPassword: 'Senha sintética de laudos 2026!' }).expect(200)
    signatureId = responseBody<{ signature: { id: string } }>(await doctor('post', '/physicians/me/signature').attach('signature', await syntheticSignature(), { filename: 'signature.png', contentType: 'image/png' }).expect(200)).signature.id
    doctorId = (await f.database.query<Array<{ user_id: string }>>('SELECT user_id FROM physicians WHERE crm=$1', ['87654/SE']))[0]!.user_id
    const second = responseBody<{ initialPassword: string }>(await f.api('post', '/physicians').send({ email: 'second-doctor@integration.test', name: 'Segundo médico sintético', crm: '87655/SE', allUnits: true }).expect(201))
    secondDoctor = await authenticatedTestRequest(f.server, '87655/SE', second.initialPassword)
    await secondDoctor('put', '/auth/password').send({ currentPassword: second.initialPassword, newPassword: 'Outra senha sintética de laudos 2026!' }).expect(200)
    await secondDoctor('post', '/physicians/me/signature').attach('signature', await syntheticSignature(), { filename: 'signature.png', contentType: 'image/png' }).expect(200)
    const roles = responseBody<Array<{ id: string; code: string }>>(await f.api('get', '/access-control/roles').expect(200))
    const account = responseBody<{ initialPassword: string }>(await f.api('post', '/company-memberships').send({ email: 'results@hospital.example.test', fullName: 'Hospital sintético', roleId: roles.find(r => r.code === 'HOSPITAL')!.id, allUnits: false, unitIds: [f.unit] }).expect(201))
    hospital = await authenticatedTestRequest(f.server, 'results@hospital.example.test', account.initialPassword)
    await hospital('put', '/auth/password').send({ currentPassword: account.initialPassword, newPassword: 'Senha sintética do hospital 2026!' }).expect(200)
  }, 45000)
  afterAll(async () => { await f?.app.close() })
  beforeEach(() => {
    // Each business-flow case has its own rate-limit window; production limits remain unchanged.
    const storage = f.app.get<{ onApplicationShutdown: () => void; storage: Map<string, unknown> }>(getStorageToken())
    storage.onApplicationShutdown()
    storage.storage.clear()
  })
  const prepared = async (originUnit?: string) => {
    const exam = await f.exam()
    await f.prepare(exam.id)
    await doctor('post', `/exams/${exam.id}/workflow/start`).send({ expectedVersion: (await f.current(exam.id)).exam.workflowVersion, reason: 'Médico iniciou a elaboração' }).expect(201)
    await f.database.query(`INSERT INTO hospital_intakes(company_id,unit_id,study_uid,identity_hash,status,exam_id,recipient_company_id,recipient_unit_id)
      VALUES($1,$2,$3,$4,'SUBMITTED',$5,$1,$6)`, [initialCompanyId, originUnit ?? f.unit, 'qa.' + randomUUID(), randomUUID(), exam.id, f.unit])
    return exam.id
  }
  const finalize = async (id: string) => {
    const saved = responseBody<{ contentHash: string }>(await doctor('put', `/exams/${id}/report`).send({ content }).expect(200))
    const version = responseBody<{ workflowVersion: number }>(await doctor('get', `/exams/${id}/workflow-status`).expect(200)).workflowVersion
    return doctor('post', `/exams/${id}/report/finalize`).send({ signatureId, expectedVersion: version, contentHash: saved.contentHash })
  }
  it('rejects nonmedical completion and reports whose elaboration has not started', async () => {
    const id = (await f.exam()).id
    await f.api('post', `/exams/${id}/report/finalize`).send({ signatureId, expectedVersion: 1, contentHash: 'a'.repeat(64) }).expect(403)
    await doctor('put', `/exams/${id}/report`).send({ content }).expect(409)
    await doctor('post', `/exams/${id}/report/finalize`).send({ signatureId, expectedVersion: 1, contentHash: 'a'.repeat(64) }).expect(409)
  })
  it('finalizes exactly once, freezes the report and exposes it only after explicit delivery', async () => {
    const id = await prepared()
    const saved = responseBody<{ contentHash: string }>(await doctor('put', `/exams/${id}/report`).send({ content }).expect(200))
    const dto = { signatureId, expectedVersion: (await f.current(id)).exam.workflowVersion, contentHash: saved.contentHash }
    const responses = await Promise.all([doctor('post', `/exams/${id}/report/finalize`).send(dto), doctor('post', `/exams/${id}/report/finalize`).send(dto)])
    expect(responses.map(r => r.status)).toEqual([201, 201])
    const completed = responseBody<{ id: string; sentAt: string | null; physician: { crm: string } }>(responses[0])
    expect(responseBody<{ id: string }>(responses[1]).id).toBe(completed.id)
    expect(completed.sentAt).toBeNull()
    expect(completed.physician.crm).toBe('87654/SE')
    expect((await f.current(id)).exam.workflowState).toBe('TYPED')
    await doctor('put', `/exams/${id}/report`).send({ content }).expect(409)
    await f.act(id, 'reopen', 409)
    await hospital('get', `/exams/${id}/report`).expect(403)
    await hospital('get', `/hospital/results/${completed.id}`).expect(404)
    expect(responseBody<unknown[]>(await hospital('get', '/hospital/results').expect(200))).toHaveLength(0)
    await f.api('post', `/exams/${id}/report/send`).send({ completionId: completed.id }).expect(201)
    const received = responseBody<{ content: unknown; sentAt: string }>(await hospital('get', `/hospital/results/${completed.id}`).expect(200))
    expect(received.content).toEqual(content)
    expect(received.sentAt).toBeTruthy()
    await f.api('post', `/exams/${id}/report/send`).send({ completionId: completed.id }).expect(201)
    const events = await f.database.query<Array<{ action: string; count: number }>>(`SELECT action,COUNT(*)::int AS count FROM operational_events WHERE resource_id=$1 AND action IN ('REPORT_FINALIZED','REPORT_DELIVERED') GROUP BY action`, [id])
    expect(events).toEqual(expect.arrayContaining([{ action: 'REPORT_FINALIZED', count: 1 }, { action: 'REPORT_DELIVERED', count: 1 }]))
    await expect(f.database.query('UPDATE exam_report_completions SET snapshot=$2 WHERE id=$1', [completed.id, '{}'])).rejects.toThrow()
  })
  it('rejects empty or stale documents and returns no completion on failure', async () => {
    const id = await prepared()
    await doctor('put', `/exams/${id}/report`).send({ content: { type: 'doc', content: [{ type: 'paragraph' }] } }).expect(200)
    const version = (await f.current(id)).exam.workflowVersion
    await doctor('post', `/exams/${id}/report/finalize`).send({ signatureId, expectedVersion: version, contentHash: '0'.repeat(64) }).expect(409)
    const empty = responseBody<{ contentHash: string }>(await doctor('put', `/exams/${id}/report`).send({ content: { type: 'doc', content: [] } }).expect(200))
    await doctor('post', `/exams/${id}/report/finalize`).send({ signatureId, expectedVersion: version, contentHash: empty.contentHash }).expect(400)
    expect((await doctor('get', `/exams/${id}/report/completion`).expect(200)).body).toEqual({ completion: null })
  })
  it('requires explicit signature selection and preserves its image after a subsequent replacement', async () => {
    const id = await prepared()
    const saved = responseBody<{ contentHash: string }>(await doctor('put', `/exams/${id}/report`).send({ content }).expect(200))
    const dto = { expectedVersion: (await f.current(id)).exam.workflowVersion, contentHash: saved.contentHash }
    await doctor('post', `/exams/${id}/report/finalize`).send(dto).expect(400)
    await doctor('post', `/exams/${id}/report/finalize`).send({ ...dto, signatureId: randomUUID() }).expect(409)
    const finished = responseBody<{ id: string; signature: { id: string; dataUrl: string; sha256: string } }>(await finalize(id).then(response => { expect(response.status).toBe(201); return response }))
    expect(finished.signature.id).toBe(signatureId)
    const replacement = responseBody<{ signature: { id: string; sha256: string } }>(await doctor('post', '/physicians/me/signature').attach('signature', await syntheticSignature(2), { filename: 'new-signature.png', contentType: 'image/png' }).expect(200))
    signatureId = replacement.signature.id
    expect(replacement.signature.sha256).not.toBe(finished.signature.sha256)
    const preserved = responseBody<{ signature: unknown }>(await doctor('get', `/exams/${id}/report/completion`).expect(200))
    expect(preserved.signature).toEqual(finished.signature)
    await f.api('post', `/exams/${id}/report/send`).send({ completionId: finished.id }).expect(201)
    expect(responseBody<{ signature: unknown }>(await hospital('get', `/hospital/results/${finished.id}`).expect(200)).signature).toEqual(finished.signature)
  })
  it('preserves origin hospital isolation for list and direct document access', async () => {
    const id = await prepared(f.secondUnit)
    const response = await finalize(id)
    expect(response.status).toBe(201)
    const completed = responseBody<{ id: string }>(response)
    await f.api('post', `/exams/${id}/report/send`).send({ completionId: completed.id }).expect(201)
    await hospital('get', `/hospital/results/${completed.id}`).expect(404)
    const list = responseBody<Array<{ id: string }>>(await hospital('get', '/hospital/results').expect(200))
    expect(list.some(item => item.id === completed.id)).toBe(false)
  })
  it('rolls completion back when transactional auditing fails', async () => {
    const id = await prepared()
    const failure = jest.spyOn(f.app.get(OperationalAuditService), 'record').mockRejectedValueOnce(new Error('SYNTHETIC_AUDIT_FAILURE'))
    try { expect((await finalize(id)).status).toBe(500) } finally { failure.mockRestore() }
    expect((await f.current(id)).exam.workflowState).toBe('IN_PROGRESS')
    expect((await doctor('get', `/exams/${id}/report/completion`).expect(200)).body).toEqual({ completion: null })
  })
  it('blocks completion while complementary files await hospital review', async () => {
    const id = await prepared()
    await f.database.query("UPDATE hospital_intakes SET status='DRAFT' WHERE exam_id=$1", [id])
    expect((await finalize(id)).status).toBe(409)
  })
  it('does not deliver a finalized report after the evidence changes', async () => {
    const id = await prepared()
    const response = await finalize(id)
    expect(response.status).toBe(201)
    const completed = responseBody<{ id: string }>(response)
    await f.database.query('UPDATE exams SET evidence_version=evidence_version+1 WHERE id=$1', [id])
    await f.api('post', `/exams/${id}/report/send`).send({ completionId: completed.id }).expect(409)
    await hospital('get', `/hospital/results/${completed.id}`).expect(404)
  })
  it('starts, finalizes and returns an unclassified exam without preparation or checklist confirmation', async () => {
    const id = (await f.exam({ examTypeId: undefined, studyDescription: 'Exame sem classificação ' + randomUUID() })).id
    const before = await f.current(id)
    expect(before.checklist.satisfied).toBe(false)
    expect(before.exam.preparedAt).toBeNull()
    expect(before.exam.normalizationStatus).not.toBe('APPROVED')
    await f.database.query(`INSERT INTO hospital_intakes(company_id,unit_id,study_uid,identity_hash,status,exam_id,recipient_company_id,recipient_unit_id)
      VALUES($1,$2,$3,$4,'SUBMITTED',$5,$1,$2)`, [initialCompanyId, f.unit, 'qa.' + randomUUID(), randomUUID(), id])
    await doctor('post', `/exams/${id}/workflow/start`).send({ expectedVersion: before.exam.workflowVersion, reason: 'Elaboração direta sem preparação' }).expect(201)
    const current = await f.current(id)
    expect(current.exam.workflowState).toBe('IN_PROGRESS')
    expect(current.exam.preparedAt).toBeNull()
    expect(current.checklist.satisfied).toBe(false)
    const response = await finalize(id)
    expect(response.status).toBe(201)
    const completed = responseBody<{ id: string }>(response)
    await f.api('post', `/exams/${id}/report/send`).send({ completionId: completed.id }).expect(201)
    await hospital('get', `/hospital/results/${completed.id}`).expect(200)
  })
  it('allows direct reporting when the hospital has no preparation policy configured', async () => {
    const id = (await f.exam({ unitId: f.secondUnit })).id
    const before = await f.current(id)
    expect(before.checklist.satisfied).toBe(false)
    await doctor('post', `/exams/${id}/workflow/start`).send({ expectedVersion: before.exam.workflowVersion, reason: 'Elaboração sem regra de preparação' }).expect(201)
    expect((await finalize(id)).status).toBe(201)
  })
  it('keeps pending hospital reception blocked even when preparation is optional', async () => {
    const id = (await f.exam()).id
    await f.database.query(`INSERT INTO hospital_intakes(company_id,unit_id,study_uid,identity_hash,status,exam_id,recipient_company_id,recipient_unit_id)
      VALUES($1,$2,$3,$4,'DRAFT',$5,$1,$2)`, [initialCompanyId, f.unit, 'qa.' + randomUUID(), randomUUID(), id])
    await doctor('post', `/exams/${id}/workflow/start`).send({ expectedVersion: (await f.current(id)).exam.workflowVersion, reason: 'Tentativa durante recebimento' }).expect(409)
  })
  const queueIds = async (api: typeof doctor, assignment: 'MINE' | 'UNASSIGNED') =>
    responseBody<{ items: Array<{ id: string }> }>(await api('get', `/exams?assignment=${assignment}&pageSize=50`).expect(200)).items.map(item => item.id)

  it('moves an exam to the responsible doctor queue and retains it without an open editor', async () => {
    const id = (await f.exam()).id
    expect(await queueIds(doctor, 'UNASSIGNED')).toContain(id)
    await doctor('post', `/exams/${id}/workflow/start`).send({ expectedVersion: 1, reason: 'Assumindo na fila pessoal' }).expect(201)
    expect(await queueIds(doctor, 'UNASSIGNED')).not.toContain(id)
    expect(await queueIds(doctor, 'MINE')).toContain(id)
    expect(await queueIds(secondDoctor, 'MINE')).not.toContain(id)
    expect((await f.current(id)).exam.reportingUserId).toBe(doctorId)
    expect((await f.database.query<Array<{ count: string }>>('SELECT count(*) FROM exam_report_presences WHERE exam_id=$1', [id]))[0]!.count).toBe('0')
    await secondDoctor('put', `/exams/${id}/report`).send({ content }).expect(403)
    await secondDoctor('post', `/exams/${id}/report/finalize`).send({ signatureId, expectedVersion: 2, contentHash: 'a'.repeat(64) }).expect(403)
    await f.api('get', '/exams?assignment=MINE').expect(403)
    await f.act(id, 'reopen')
    expect(await queueIds(doctor, 'MINE')).not.toContain(id)
    expect(await queueIds(secondDoctor, 'UNASSIGNED')).toContain(id)
  })

  it('allows only one doctor to acquire the exam concurrently and rolls assignment back on audit failure', async () => {
    const id = (await f.exam()).id
    const dto = { expectedVersion: 1, reason: 'Aquisição concorrente na fila' }
    const responses = await Promise.all([doctor('post', `/exams/${id}/workflow/start`).send(dto), secondDoctor('post', `/exams/${id}/workflow/start`).send(dto)])
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    const owner = responses[0].status === 201 ? doctor : secondDoctor
    const other = responses[0].status === 201 ? secondDoctor : doctor
    expect(await queueIds(owner, 'MINE')).toContain(id)
    expect(await queueIds(other, 'MINE')).not.toContain(id)
    await f.act(id, 'cancel')
    expect(await queueIds(owner, 'MINE')).not.toContain(id)

    const failedId = (await f.exam()).id
    const failure = jest.spyOn(f.app.get(OperationalAuditService), 'record').mockRejectedValueOnce(new Error('SYNTHETIC_ASSIGNMENT_AUDIT_FAILURE'))
    try { await doctor('post', `/exams/${failedId}/workflow/start`).send(dto).expect(500) } finally { failure.mockRestore() }
    expect((await f.current(failedId)).exam.reportingUserId).toBeNull()
    expect(await queueIds(doctor, 'UNASSIGNED')).toContain(failedId)
  })

  it('keeps completed reports in the personal queue until they are sent to the hospital', async () => {
    const id = await prepared()
    const completed = responseBody<{ id: string }>(await finalize(id))
    expect(await queueIds(doctor, 'MINE')).toContain(id)
    await f.api('post', `/exams/${id}/report/send`).send({ completionId: completed.id }).expect(201)
    expect(await queueIds(doctor, 'MINE')).not.toContain(id)
    expect((await f.current(id)).exam.reportingUserId).toBe(doctorId)
  })
})
