import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'

describe('Physician qualifications consume the canonical exam catalog (e2e)', () => {
  let fixture: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>
  let physician: { id: string; userId: string; membershipId: string }
  let type: { id: string; version: number }
  const create = (values: Record<string, unknown> = {}) =>
    fixture
      .api('post', `/physicians/${physician.id}/qualifications`)
      .send({
        unitId: fixture.unit,
        examTypeId: type.id,
        reason: 'Habilitação conferida pelo gestor',
        ...values,
      })
  beforeAll(async () => {
    fixture = await createOperationalDocumentsFixture()
    const specialties = responseBody<Array<{ id: string }>>(
      await fixture.api('get', '/physicians/specialties').expect(200),
    )
    physician = responseBody<typeof physician>(
      await fixture
        .api('post', '/physicians')
        .send({ email: 'doctor-crmtest2026@integration.test',
          name: 'Médica Habilitação',
          crm: 'CRM TEST 2026',
          specialtyId: specialties[0]!.id,
          allUnits: false,
          unitIds: [fixture.unit],
        })
        .expect(201),
    )
    type = responseBody<typeof type>(
      await fixture
        .api('post', '/exam-catalog/types')
        .send({ name: 'TC habilitação', modality: 'CT', groupName: 'Teste', active: true })
        .expect(201),
    )
  }, 30000)
  afterAll(async () => {
    await fixture?.app.close()
  })
  it('uses the same canonical ID as the exam and requires an active unit membership', async () => {
    const record = responseBody<{ id: string }>(await create().expect(201))
    const listed = responseBody<unknown[]>(
      await fixture.api('get', `/physicians/${physician.id}/qualifications`).expect(200),
    )
    expect(listed).toEqual([
      expect.objectContaining({
        id: record.id,
        unitId: fixture.unit,
        examTypeId: type.id,
        modality: 'CT',
        active: true,
      }),
    ])
    await create().expect(409)
    await create({ unitId: fixture.secondUnit }).expect(400)
    await create({ reason: ' ' }).expect(400)
    await fixture
      .api('get', `/physicians/${physician.id}/qualifications`)
      .set('X-Unit-Id', fixture.secondUnit)
      .expect(404)
  })
  it('requires both approved classification and an operational physician account', async () => {
    const unknown = await fixture.exam()
    expect(
      responseBody<{ reason: string }>(
        await fixture.api('get', `/exams/${unknown.id}/eligible-physicians`).expect(200),
      ).reason,
    ).toBe('CLASSIFICATION_REQUIRED')
    const classified = await fixture.exam({ examTypeId: type.id })
    const eligible = () => fixture.api('get', `/exams/${classified.id}/eligible-physicians`)
    expect(responseBody<{ items: unknown[] }>(await eligible().expect(200)).items).toEqual([])
    await fixture.database.query('UPDATE auth_users SET must_change_password=false WHERE id=$1', [
      physician.userId,
    ])
    expect(responseBody<{ items: unknown[] }>(await eligible().expect(200)).items).toEqual([
      expect.objectContaining({ physicianId: physician.id, examTypeId: type.id, modality: 'CT' }),
    ])
    await fixture.database.query('UPDATE company_memberships SET active=false WHERE id=$1', [
      physician.membershipId,
    ])
    expect(responseBody<{ items: unknown[] }>(await eligible().expect(200)).items).toEqual([])
    await fixture.database.query('UPDATE company_memberships SET active=true WHERE id=$1', [
      physician.membershipId,
    ])
    await fixture.database.query(
      'UPDATE company_membership_units SET active=false WHERE membership_id=$1 AND unit_id=$2',
      [physician.membershipId, fixture.unit],
    )
    expect(responseBody<{ items: unknown[] }>(await eligible().expect(200)).items).toEqual([])
    await fixture.database.query(
      'UPDATE company_membership_units SET active=true WHERE membership_id=$1 AND unit_id=$2',
      [physician.membershipId, fixture.unit],
    )
  })
  it('versions activation changes, prevents stale decisions and preserves audit evidence', async () => {
    const records = responseBody<Array<{ id: string; version: number }>>(
      await fixture.api('get', `/physicians/${physician.id}/qualifications`).expect(200),
    )
    const record = records[0]!
    const update = (active: boolean, expectedVersion: number) =>
      fixture
        .api('put', `/physicians/${physician.id}/qualifications/${record.id}`)
        .send({ active, expectedVersion, reason: 'Revisão da habilitação' })
    await update(false, record.version).expect(200)
    await update(true, record.version).expect(409)
    await update(true, record.version + 1).expect(200)
    expect(
      await fixture.database.query<Array<{ count: number }>>(
        "SELECT COUNT(*)::int AS count FROM operational_events WHERE action='PHYSICIAN_QUALIFICATION_CHANGED' AND resource_id=$1",
        [physician.id],
      ),
    ).toEqual([{ count: 3 }])
  })
  it('prevents changing the modality of a type used in medical qualifications', async () => {
    await fixture
      .api('put', `/exam-catalog/types/${type.id}`)
      .send({
        name: 'TC habilitação',
        modality: 'MR',
        groupName: 'Teste',
        active: true,
        expectedVersion: type.version,
      })
      .expect(409)
  })
  it('excludes inactive types and refuses qualifications from another company', async () => {
    const classified = await fixture.exam({ examTypeId: type.id })
    await fixture
      .api('put', `/exam-catalog/types/${type.id}`)
      .send({
        name: 'TC habilitação',
        modality: 'CT',
        groupName: 'Teste',
        active: false,
        expectedVersion: type.version,
      })
      .expect(200)
    expect(
      responseBody<{ items: unknown[] }>(
        await fixture.api('get', `/exams/${classified.id}/eligible-physicians`).expect(200),
      ).items,
    ).toEqual([])
    await create({ unitId: fixture.secondUnit }).expect(400)
    const company = responseBody<{ id: string }>(
      await fixture
        .api('post', '/companies')
        .send({ name: 'Empresa Habilitações Externas' })
        .expect(201),
    )
    await fixture.api('get', `/physicians/${physician.id}/qualifications`, company.id).expect(404)
  })
})
