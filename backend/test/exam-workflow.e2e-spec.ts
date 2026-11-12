import { randomUUID } from 'node:crypto'
import type { ExamEntity } from '../src/database/entities/exam.entity'
import { OperationalAuditService } from '../src/modules/companies/operational-audit.service'
import { responseBody } from './operational-documents.fixture'
import { createWorkflowFixture } from './workflow.fixture'

describe('Exam preparation and transitions (e2e)', () => {
  let f: Awaited<ReturnType<typeof createWorkflowFixture>>
  beforeAll(async () => { f = await createWorkflowFixture() }, 30000)
  afterAll(async () => { await f?.app.close() })
  it('requires configured rules, valid evidence and manual conference before release', async () => {
    const missing = await f.exam({ unitId: f.secondUnit })
    await f.act(missing.id, 'release', 409)
    const exam = await f.exam()
    await f.act(exam.id, 'release', 409)
    await f.act(exam.id, 'check', 409, { items: [{ item: 'ORDER', confirmed: true }] })
    await f.upload(exam.id)
    await f.act(exam.id, 'release', 409)
    await f.act(exam.id, 'check', 201, { items: [{ item: 'ORDER', confirmed: true }] })
    const released = responseBody<ExamEntity>(await f.act(exam.id, 'release'))
    expect(released).toMatchObject({ workflowState: 'READY', preparedByUserId: expect.any(String) as unknown })
    expect(released.preparedAt).toBeTruthy()
    await f.act(exam.id, 'start')
    await f.act(exam.id, 'release', 409)
    // No public path may forge clinical completion or a digital signature.
    await f.act(exam.id, 'sign', 404)
    expect((await f.current(exam.id)).exam.workflowState).toBe('IN_PROGRESS')
  })
  it('allows one of two competing actions and rolls back if audit fails', async () => {
    const exam = await f.exam()
    await f.prepare(exam.id)
    const version = (await f.current(exam.id)).exam.workflowVersion
    const results = await Promise.all(['start','cancel'].map(action => f.api('post', `/exams/${exam.id}/workflow/${action}`).send({ expectedVersion: version, reason: 'Concorrência sintética' })))
    expect(results.map(r => r.status).sort()).toEqual([201, 409])
    const another = await f.exam()
    const audit = jest.spyOn(f.app.get(OperationalAuditService), 'record').mockRejectedValueOnce(new Error('audit unavailable'))
    await f.act(another.id, 'cancel', 500)
    audit.mockRestore()
    expect((await f.current(another.id)).exam.workflowState).toBe('TO_PREPARE')
    expect((await f.current(another.id)).history).toEqual([])
  })
  it('invalidates previous checks and release when a document or rule changes', async () => {
    const exam = await f.exam()
    const old = await f.upload(exam.id)
    await f.act(exam.id, 'check', 201, { items: [{ item: 'ORDER', confirmed: true }] })
    await f.act(exam.id, 'release')
    const before = (await f.current(exam.id)).exam
    await f.upload(exam.id, { replacesId: old.id, expectedVersion: '1', reason: 'Pedido corrigido' })
    const changed = await f.current(exam.id)
    expect(changed.exam.workflowState).toBe('TO_PREPARE')
    expect(changed.exam.preparedAt).toBeNull()
    expect(changed.exam.evidenceVersion).toBeGreaterThan(before.evidenceVersion)
    expect(changed.checklist.satisfied).toBe(false)
    await f.api('post', '/preparation-policies').send({ unitId: f.unit, expectedVersion: 1, requiredItems: ['ORDER'], reason: 'Revisão sintética da regra' }).expect(201)
    await f.api('post', '/preparation-policies').send({ unitId: f.unit, expectedVersion: 1, requiredItems: [], reason: 'Regra concorrente' }).expect(409)
    expect((await f.current(exam.id)).checklist.satisfied).toBe(false)
  })
  it('uses scoped technician permissions and never grants draft or exception access', async () => {
    const technician = await f.technician(), exam = await f.exam(), other = await f.exam({ unitId: f.secondUnit })
    const state = await f.current(exam.id)
    const check = (path: string, body: object) => technician.api('post', `/exams/${exam.id}/workflow/${path}`).send(body)
    await technician.api('get', `/exams/${other.id}/workflow`).expect(404)
    await technician.api('get', `/exams/${exam.id}/report`).expect(403)
    await check('check', { expectedVersion: state.exam.workflowVersion, reason: 'Dispensa de pedido', items: [{ item: 'ORDER', confirmed: true, exceptionReason: 'Sem pedido' }] }).expect(403)
    await check('cancel', { expectedVersion: state.exam.workflowVersion, reason: 'Cancelar pelo técnico' }).expect(403)
    await f.upload(exam.id)
    const current = await f.current(exam.id)
    await check('priority', { expectedVersion: current.exam.workflowVersion, priority: 'URGENTE', reason: 'Prioridade conferida' }).expect(201)
    const next = (await f.current(exam.id)).exam
    await check('fields', { expectedVersion: next.workflowVersion, requesterName: 'Solicitante teste', reason: 'Correção sintética', patientName: 'Alteração indevida' }).expect(400)
    await check('fields', { expectedVersion: next.workflowVersion, requesterName: 'Solicitante teste', reason: 'Correção sintética' }).expect(201)
    const version = (await f.current(exam.id)).exam.workflowVersion
    const checked = responseBody<ExamEntity>(await check('check', { expectedVersion: version, reason: 'Pedido conferido pelo técnico', items: [{ item: 'ORDER', confirmed: true }] }).expect(201))
    await check('release', { expectedVersion: checked.workflowVersion, reason: 'Liberado pelo técnico' }).expect(201)
    await technician.api('post', `/exams/${other.id}/workflow/priority`).send({ expectedVersion: 1, priority: 'ALTA', reason: 'Outra unidade' }).expect(404)
    await check('start', { expectedVersion: checked.workflowVersion + 1, reason: 'Iniciar elaboração' }).expect(403)
    await check('priority', { expectedVersion: checked.workflowVersion + 1, priority: 'ROTINA', reason: 'Após liberação' }).expect(409)
    await f.api('post', '/preparation-policies').send({ unitId: f.unit, examTypeId: randomUUID(), expectedVersion: 0, requiredItems: [], reason: 'Tipo inexistente' }).expect(400)
  })
  it('records authorized exceptions with an actor and keeps them in history', async () => {
    const exam = await f.exam()
    await f.act(exam.id, 'check', 201, { items: [{ item: 'ORDER', confirmed: true, exceptionReason: 'Dispensa autorizada para cenário sintético' }] })
    await f.act(exam.id, 'release')
    const checks = await f.database.query<Array<{ exception_reason: string; checked_by_user_id: string }>>('SELECT * FROM preparation_checks WHERE exam_id=$1', [exam.id])
    expect(checks[0]?.exception_reason).toContain('autorizada')
    expect(checks[0]?.checked_by_user_id).toBeTruthy()
  })
})
