import type { Server } from 'node:http'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { authenticatedTestRequest } from './authenticated-test-request'
import { syntheticSignature } from './synthetic-signature'
import type { ContrastProtocolEntity } from '../src/database/entities/contrast-protocol.entity'
import type { ExamPriceRuleEntity } from '../src/database/entities/exam-price-rule.entity'
import { CatalogConsumers1860000000000 } from '../src/database/migrations/1860000000000-CatalogConsumers'
describe('Canonical catalog consumers: protocols, prescriptions and prices (e2e)', () => {
  let fixture: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>,
    doctorApi: Awaited<ReturnType<typeof authenticatedTestRequest>>
  let physician: { id: string; userId: string; initialPassword: string },
    type: { id: string; version: number },
    exam: { id: string; patientId: string },
    protocol: ContrastProtocolEntity,
    selection: { selectionId: string; content: Record<string, unknown> },
    billing: ExamPriceRuleEntity
  const protocolData = (data: Record<string, unknown> = {}) => ({
    examTypeId: type.id,
    unitId: fixture.unit,
    name: 'Protocolo sintético',
    template: 'Valor de teste: {{value}}\n{{observations}}',
    fields: [{ key: 'value', label: 'Valor de teste', kind: 'NUMBER', unit: 'u', required: true }],
    notes: 'Conteúdo sintético de validação',
    ...data,
  })
  const priceData = (data: Record<string, unknown> = {}) => ({
    examTypeId: type.id,
    kind: 'BILLING',
    currency: 'BRL',
    amount: '100.10',
    validFrom: '2026-01-01',
    reason: 'Tabela sintética de validação',
    ...data,
  })
  beforeAll(async () => {
    fixture = await createOperationalDocumentsFixture()
    type = responseBody<typeof type>(
      await fixture
        .api('post', '/exam-catalog/types')
        .send({ name: 'TC consumidores', modality: 'CT', groupName: 'Teste', active: true })
        .expect(201),
    )
    const specialties = responseBody<Array<{ id: string }>>(
      await fixture.api('get', '/physicians/specialties').expect(200),
    )
    physician = responseBody<typeof physician>(
      await fixture
        .api('post', '/physicians')
        .send({ email: 'doctor-crmconsumer2026@integration.test',
          name: 'Médico revisão sintética',
          crm: 'CRM CONSUMER 2026',
          specialtyId: specialties[0]!.id,
          allUnits: true,
          unitIds: [],
        })
        .expect(201),
    )
    await fixture.database.query('UPDATE auth_users SET must_change_password=false WHERE id=$1', [
      physician.userId,
    ])
    doctorApi = await authenticatedTestRequest(
      fixture.app.getHttpServer() as Server,
      'CRM CONSUMER 2026',
      physician.initialPassword,
    )
    await doctorApi('post', '/physicians/me/signature')
      .attach('signature', await syntheticSignature(), { filename: 'signature.png', contentType: 'image/png' }).expect(200)
    exam = await fixture.exam({ examTypeId: type.id })
  }, 30000)
  afterAll(async () => {
    await fixture?.database.query(
      "DELETE FROM access_role_permissions WHERE permission_code IN ('exam.prices.view','exam.prices.manage') AND role_id IN (SELECT id FROM access_roles WHERE code='DOCTOR')",
    )
    await fixture?.app.close()
  })
  it('creates immutable draft protocols with the canonical exam type and validates placeholders', async () => {
    await fixture
      .api('post', `/physicians/${physician.id}/qualifications`)
      .send({
        unitId: fixture.unit,
        examTypeId: type.id,
        reason: 'Habilitação sintética para o mesmo tipo canônico',
      })
      .expect(201)
    expect(
      responseBody<{ items: unknown[] }>(
        await fixture.api('get', `/exams/${exam.id}/eligible-physicians`).expect(200),
      ).items,
    ).toEqual([expect.objectContaining({ physicianId: physician.id, examTypeId: type.id })])
    protocol = responseBody<ContrastProtocolEntity>(
      await fixture.api('post', '/contrast-protocols').send(protocolData()).expect(201),
    )
    expect(protocol).toMatchObject({
      examTypeId: type.id,
      modality: 'CT',
      version: 1,
      status: 'DRAFT',
    })
    expect(
      responseBody<{ items: unknown[] }>(
        await fixture.api('get', `/exams/${exam.id}/contrast-protocols`).expect(200),
      ).items,
    ).toEqual([])
    await fixture
      .api('post', '/contrast-protocols')
      .send(protocolData({ template: 'Campo {{unknown}}' }))
      .expect(400)
  })
  it('requires a valid clinical reviewer, reference and current state before activation', async () => {
    await fixture
      .api('post', `/contrast-protocols/${protocol.id}/activate`)
      .send({
        expectedStateVersion: 0,
        approvedByPhysicianId: physician.id,
        approvalReference: ' ',
      })
      .expect(400)
    await fixture
      .api('post', `/contrast-protocols/${protocol.id}/activate`)
      .send({
        expectedStateVersion: 9,
        approvedByPhysicianId: physician.id,
        approvalReference: 'Revisão sintética',
      })
      .expect(409)
    protocol = responseBody<ContrastProtocolEntity>(
      await fixture
        .api('post', `/contrast-protocols/${protocol.id}/activate`)
        .send({
          expectedStateVersion: 0,
          approvedByPhysicianId: physician.id,
          approvalReference: 'Revisão sintética documentada',
        })
        .expect(201),
    )
    expect(
      responseBody<{ items: unknown[] }>(
        await doctorApi('get', `/exams/${exam.id}/contrast-protocols`).expect(200),
      ).items,
    ).toEqual([expect.objectContaining({ id: protocol.id })])
  })
  it('generates from provided values, saves structured origin and reopens the same document', async () => {
    await doctorApi('post', `/exams/${exam.id}/prescription/protocol`)
      .send({ protocolId: protocol.id, values: {}, observations: '' })
      .expect(400)
    selection = responseBody<typeof selection>(
      await doctorApi('post', `/exams/${exam.id}/prescription/protocol`)
        .send({ protocolId: protocol.id, values: { value: '12,50' }, observations: 'Teste' })
        .expect(201),
    )
    await doctorApi('put', `/exams/${exam.id}/prescription`)
      .send({ content: selection.content, protocolSelectionId: selection.selectionId })
      .expect(200)
    expect(
      responseBody<unknown>(await doctorApi('get', `/exams/${exam.id}/prescription`).expect(200)),
    ).toMatchObject({
      content: selection.content,
      protocolSource: {
        selectionId: selection.selectionId,
        protocolVersion: 1,
        values: { value: '12,50' },
        renderedText: 'Valor de teste: 12.50 u\nTeste',
      },
    })
  })
  it('replaces an approved version without changing previously saved prescriptions', async () => {
    const next = responseBody<ContrastProtocolEntity>(
      await fixture
        .api('post', '/contrast-protocols')
        .send(
          protocolData({
            previousId: protocol.id,
            template: 'Novo texto: {{value}}\n{{observations}}',
          }),
        )
        .expect(201),
    )
    await fixture
      .api('post', `/contrast-protocols/${next.id}/activate`)
      .send({
        expectedStateVersion: 0,
        approvedByPhysicianId: physician.id,
        approvalReference: 'Segunda revisão sintética',
      })
      .expect(201)
    expect(
      responseBody<unknown>(await doctorApi('get', `/exams/${exam.id}/prescription`).expect(200)),
    ).toMatchObject({
      protocolSource: {
        protocolId: protocol.id,
        protocolVersion: 1,
        renderedText: 'Valor de teste: 12.50 u\nTeste',
      },
    })
    await doctorApi('post', `/exams/${exam.id}/prescription/protocol`)
      .send({ protocolId: protocol.id, values: { value: '10' }, observations: '' })
      .expect(400)
    await fixture
      .api('post', '/contrast-protocols')
      .send(protocolData({ previousId: protocol.id }))
      .expect(409)
  })
  it('isolates protocol sources by exam, unit and company and blocks unclassified exams', async () => {
    const other = await fixture.exam({ examTypeId: type.id })
    await doctorApi('put', `/exams/${other.id}/prescription`)
      .send({ content: selection.content, protocolSelectionId: selection.selectionId })
      .expect(404)
    const unknown = await fixture.exam()
    await doctorApi('post', `/exams/${unknown.id}/prescription/protocol`)
      .send({ protocolId: protocol.id, values: { value: '10' }, observations: '' })
      .expect(409)
    await fixture
      .api('post', `/contrast-protocols/${protocol.id}/retire`)
      .set('X-Unit-Id', fixture.secondUnit)
      .send({ expectedStateVersion: protocol.stateVersion, reason: 'Teste' })
      .expect(404)
    const company = responseBody<{ id: string }>(
      await fixture
        .api('post', '/companies')
        .send({ name: 'Empresa Consumidores Externa' })
        .expect(201),
    )
    await fixture
      .api('post', `/contrast-protocols/${protocol.id}/activate`, company.id)
      .send({
        expectedStateVersion: 0,
        approvedByPhysicianId: physician.id,
        approvalReference: 'Teste',
      })
      .expect(404)
  })
  it('keeps billing and payout separate with exact cents and explicit precedence', async () => {
    billing = responseBody<ExamPriceRuleEntity>(
      await fixture.api('post', '/exam-prices').send(priceData()).expect(201),
    )
    await fixture
      .api('post', '/exam-prices')
      .send(priceData({ kind: 'PAYOUT', amount: '40.05' }))
      .expect(201)
    await fixture
      .api('post', '/exam-prices')
      .send(priceData({ unitId: fixture.unit, amount: '120.15' }))
      .expect(201)
    await fixture
      .api('post', '/exam-prices')
      .send(
        priceData({
          kind: 'PAYOUT',
          unitId: fixture.unit,
          physicianId: physician.id,
          amount: '50.25',
        }),
      )
      .expect(201)
    const quote = responseBody<unknown>(
      await fixture
        .api(
          'get',
          `/exam-prices/resolve?examId=${exam.id}&date=2026-10-14&physicianId=${physician.id}`,
        )
        .expect(200),
    )
    expect(quote).toMatchObject({
      billing: { amountCents: '12015', examTypeId: type.id },
      payout: { amountCents: '5025', physicianId: physician.id },
      reason: null,
    })
    await fixture
      .api('post', '/exam-prices')
      .send(priceData({ amount: '1.234' }))
      .expect(400)
    await fixture
      .api('post', '/exam-prices')
      .send(priceData({ physicianId: physician.id }))
      .expect(400)
    await fixture
      .api('post', '/exam-prices')
      .set('X-Unit-Id', fixture.unit)
      .send(priceData())
      .expect(403)
  })
  it('prevents overlapping price periods under concurrent writes', async () => {
    const additional = responseBody<{ id: string }>(
      await fixture
        .api('post', '/exam-catalog/types')
        .send({ name: 'TC concorrência preços', modality: 'CT', groupName: 'Teste', active: true })
        .expect(201),
    )
    const create = () =>
      fixture.api('post', '/exam-prices').send(priceData({ examTypeId: additional.id }))
    const results = await Promise.all([create(), create()])
    expect(results.map((result) => result.status).sort()).toEqual([201, 409])
  })
  it('preserves historical amounts when closing a period and adding the next rule', async () => {
    await fixture
      .api('post', `/exam-prices/${billing.id}/close`)
      .send({ expectedVersion: 0, validTo: '2026-10-31', reason: 'Nova vigência' })
      .expect(201)
    await fixture
      .api('post', `/exam-prices/${billing.id}/close`)
      .send({ expectedVersion: 0, validTo: '2026-10-30', reason: 'Decisão atrasada' })
      .expect(409)
    await fixture
      .api('post', '/exam-prices')
      .send(priceData({ validFrom: '2026-11-01', amount: '105.20' }))
      .expect(201)
    const rules = responseBody<ExamPriceRuleEntity[]>(
      await fixture.api('get', '/exam-prices').expect(200),
    )
    expect(rules.find((rule) => rule.id === billing.id)).toMatchObject({
      amountCents: '10010',
      validTo: '2026-10-31',
      version: 1,
    })
    const generalExam = await fixture.exam({ examTypeId: type.id, unitId: fixture.secondUnit })
    expect(
      responseBody<unknown>(
        await fixture
          .api('get', `/exam-prices/resolve?examId=${generalExam.id}&date=2026-10-14`)
          .expect(200),
      ),
    ).toMatchObject({ billing: { amountCents: '10010' } })
    expect(
      responseBody<unknown>(
        await fixture
          .api('get', `/exam-prices/resolve?examId=${generalExam.id}&date=2026-11-01`)
          .expect(200),
      ),
    ).toMatchObject({ billing: { amountCents: '10520' } })
  })
  it('restricts financial access and prevents physician price editing even with a grant', async () => {
    await doctorApi('get', '/exam-prices').expect(403)
    await doctorApi('post', '/contrast-protocols').send(protocolData()).expect(403)
    await fixture.database.query(
      "INSERT INTO access_role_permissions(role_id,permission_code) SELECT id,p.code FROM access_roles CROSS JOIN access_permissions p WHERE access_roles.code='DOCTOR' AND p.code IN ('exam.prices.view','exam.prices.manage') ON CONFLICT DO NOTHING",
    )
    await doctorApi('post', '/exam-prices')
      .send(priceData({ validFrom: '2028-01-01' }))
      .expect(403)
    await doctorApi('get', `/exam-prices/resolve?examId=${exam.id}&date=2026-10-14`).expect(403)
  })
  it('blocks rollback and modality changes after protocols and prices have been used', async () => {
    await fixture
      .api('put', `/exam-catalog/types/${type.id}`)
      .send({
        name: 'TC consumidores',
        modality: 'MR',
        groupName: 'Teste',
        active: true,
        expectedVersion: type.version,
      })
      .expect(409)
    const runner = fixture.database.createQueryRunner()
    await runner.connect()
    try {
      await expect(new CatalogConsumers1860000000000().down(runner)).rejects.toThrow(
        'Protocolos ou preços em uso',
      )
    } finally {
      await runner.release()
    }
  })
})
