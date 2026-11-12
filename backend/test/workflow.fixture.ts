import { randomUUID } from 'node:crypto'
import { AuthUserEntity } from '../src/database/entities/auth-user.entity'
import { CompanyMembershipEntity } from '../src/database/entities/company-membership.entity'
import { CompanyMembershipUnitEntity } from '../src/database/entities/company-membership-unit.entity'
import { CryptoService } from '../src/modules/auth/crypto.service'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
import type { ExamEntity } from '../src/database/entities/exam.entity'
import { authenticatedTestRequest } from './authenticated-test-request'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { syntheticPdf } from './synthetic-documents'

export const createWorkflowFixture = async () => {
  const base = await createOperationalDocumentsFixture()
  const type = responseBody<{ id: string }>(await base.api('post', '/exam-catalog/types').send({ name: 'TC fluxo sintético', modality: 'CT', groupName: 'Teste', active: true }).expect(201))
  await base.api('post', '/preparation-policies').send({ unitId: base.unit, expectedVersion: 0, requiredItems: ['ORDER'], reason: 'Regra de conferência sintética' }).expect(201)
  const exam = (values: Record<string, unknown> = {}) => base.exam({ patientName: 'Paciente Fluxo ' + randomUUID(), examTypeId: type.id, ...values })
  const current = async (id: string) => responseBody<{ exam: ExamEntity; checklist: { satisfied: boolean; blockers: string[] }; history: unknown[]; issues: Array<{ id: string; resolved_at: string | null }> }>(await base.api('get', `/exams/${id}/workflow`).expect(200))
  const act = async (id: string, action: string, status = 201, body: Record<string, unknown> = {}) => {
    const snapshot = await current(id)
    return base.api('post', `/exams/${id}/workflow/${action}`).send({ expectedVersion: snapshot.exam.workflowVersion, reason: 'Conferência operacional sintética', ...body }).expect(status)
  }
  const pdf = await syntheticPdf()
  const upload = async (id: string, values: Record<string, string> = {}) => {
    let operation = base.api('post', `/exams/${id}/attachments`).field('category', 'ORDER')
    for (const [key, value] of Object.entries(values)) operation = operation.field(key, value)
    return responseBody<{ id: string; version: number }>(await operation.attach('file', pdf, { filename: 'pedido.pdf', contentType: 'application/pdf' }).expect(201))
  }
  const prepare = async (id: string) => {
    await upload(id)
    await act(id, 'check', 201, { items: [{ item: 'ORDER', confirmed: true }] })
    return act(id, 'release')
  }
  const technician = async () => {
    const [role] = await base.database.query<Array<{ id: string }>>("SELECT id FROM access_roles WHERE company_id=$1 AND code='TECHNICIAN'", [initialCompanyId])
    const password = 'Teste operacional seguro 2026!', email = randomUUID() + '@workflow.example.test'
    const user = await base.database.getRepository(AuthUserEntity).save({ email, fullName: 'Técnico sintético', role: 'USER', accessRoleId: role!.id, passwordHash: await base.app.get(CryptoService).hashPassword(password), mustChangePassword: false, status: 'ACTIVE' })
    const membership = await base.database.getRepository(CompanyMembershipEntity).save({ userId: user.id, companyId: initialCompanyId, accessRoleId: role!.id, allUnits: false, active: true })
    await base.database.getRepository(CompanyMembershipUnitEntity).save({ membershipId: membership.id, companyId: initialCompanyId, unitId: base.unit, active: true })
    const api = await authenticatedTestRequest(base.server, email, password)
    return { api, user, membership }
  }
  return { ...base, exam, current, act, upload, prepare, technician, type }
}
