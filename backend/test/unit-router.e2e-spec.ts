import { ConfigService } from '@nestjs/config'
import { createServer, type Server } from 'node:https'
import { readFileSync } from 'node:fs'
import type { RequestListener } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID, verify } from 'node:crypto'
import request from 'supertest'
import { createOperationalDocumentsFixture, responseBody } from './operational-documents.fixture'
import { RouterMsiService } from '../src/modules/router/router-msi.service'

describe('Company units and scoped Windows Router provisioning', () => {
  let f: Awaited<ReturnType<typeof createOperationalDocumentsFixture>>, root: string, secure: Server, certificate: Buffer
  let unitId: string, config: ConfigService
  const deviceId = randomUUID()
  const company = { name: 'Hospital Router de Teste', cnpj: '37335118000180', legalName: 'Empresa Router de Teste', tradeName: 'Hospital Router de Teste', internalIdentifier: 'INTERNO-123', uf: 'SE',
    address: { zipCode: '49000000', street: 'Rua de Teste', number: '10', neighborhood: 'Centro', city: 'Aracaju' }, contactPhone: '79999999999', contactEmail: 'router@example.test' }
  beforeAll(async () => {
    jest.spyOn(RouterMsiService.prototype, 'build').mockImplementation(async (directory, unit) => {
      const body = await readFile(join(directory, 'router.profile.json'))
      const footer = Buffer.alloc(12); footer.write('CSRTR001', 0, 'ascii'); footer.writeUInt32LE(body.length, 8)
      await writeFile(join(directory, `Router-${unit}.msi`), Buffer.concat([Buffer.from('test packager'), body, footer]))
    })
    f = await createOperationalDocumentsFixture(); config = f.app.get(ConfigService)
    root = await mkdtemp(join(tmpdir(), 'sourad-router-test-')); await mkdir(join(root, 'base'))
    await writeFile(join(root, 'base', 'ClimbeSoftRadRouterSetup.exe'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048)]))
    await writeFile(join(root, 'base', 'router.payload.zip'), Buffer.from('synthetic runtime'))
    config.set('ROUTER_INSTALLER_ROOT', root); config.set('ROUTER_PUBLIC_API_URL', 'https://localhost:3443/api/v1')
    certificate = await readFile(resolve('secrets/router-local.crt'))
    secure = createServer({ cert: certificate, key: await readFile(resolve('secrets/router-local.key')) }, f.app.getHttpAdapter().getInstance() as RequestListener)
    await new Promise<void>(resolve => secure.listen(0, '127.0.0.1', resolve))
  }, 45000)
  afterAll(async () => {
    if (secure) await new Promise<void>((resolve, reject) => secure.close(error => error ? reject(error) : resolve()))
    await f?.app.close()
    jest.restoreAllMocks()
    if (root) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup path'); await rm(root, { recursive: true, force: true }) }
  })
  const decode = (bytes: Buffer) => {
    const length = bytes.readUInt32LE(bytes.length - 4)
    expect(bytes.subarray(-12, -4).toString()).toBe('CSRTR001')
    const envelope = JSON.parse(bytes.subarray(bytes.length - 12 - length, -12).toString()) as { payload: string; signature: string }
    expect(verify('RSA-SHA256', Buffer.from(envelope.payload, 'base64'), readFileSync(config.getOrThrow<string>('JWT_PUBLIC_KEY_PATH')), Buffer.from(envelope.signature, 'base64'))).toBe(true)
    return JSON.parse(Buffer.from(envelope.payload, 'base64').toString()) as { unitId: string; ticketId: string; activationCode: string; internalIdentifier: string; apiUrl: string }
  }
  const download = async () => {
    const response = await f.api('post', `/hospital-units/${unitId}/router-installer`).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.on('end', () => callback(null, Buffer.concat(chunks)))
    }).expect(201)
    return decode(response.body as Buffer)
  }
  const activate = (ticket: { ticketId: string; activationCode: string }, device = deviceId) => request(secure).post('/api/v1/router/activate').ca(certificate).send({ ticketId: ticket.ticketId, activationCode: ticket.activationCode, deviceId: device })
  it('persists company data, prepares its installer, and uses the internal identifier in the central queue', async () => {
    config.set('NODE_ENV', 'development')
    try { unitId = responseBody<{ id: string }>(await f.api('post', '/hospital-units').send(company).expect(201)).id }
    finally { config.set('NODE_ENV', 'test') }
    const rows = responseBody<Array<{ id: string; internalIdentifier: string; router: { status: string } }>>(await f.api('get', '/hospital-units/admin').expect(200))
    expect(rows.find(unit => unit.id === unitId)).toMatchObject({ internalIdentifier: 'INTERNO-123', router: { status: 'NOT_INSTALLED' } })
    const folders = await readdir(join(root, unitId)); expect(folders).toHaveLength(1)
    const installer = await readFile(join(root, unitId, folders[0]!, `Router-${unitId}.msi`))
    expect(decode(installer)).toMatchObject({ unitId, internalIdentifier: 'INTERNO-123', apiUrl: 'https://localhost:3443/api/v1' })
    await f.exam({ unitId })
    const exams = responseBody<{ items: Array<{ unit: string; unitName: string }> }>(await f.api('get', '/exams').expect(200))
    expect(exams.items.some(exam => exam.unit === 'INTERNO-123' && exam.unitName === company.name)).toBe(true)
    await f.api('post', '/hospital-units').send({ ...company, name: 'CNPJ inválido', cnpj: '37335118000181' }).expect(400)
  })
  it('restricts installer download and forbids activation over plaintext HTTP', async () => {
    await f.api('post', `/hospital-units/${unitId}/router-installer`).set('X-Unit-Id', f.secondUnit).expect(404)
    const ticket = await download()
    await request(f.server).post('/api/v1/router/activate').send({ ticketId: ticket.ticketId, activationCode: ticket.activationCode, deviceId }).expect(403)
  })
  it('activates once per device, encrypts credentials, isolates hospitals, and reports online/offline', async () => {
    const ticket = await download()
    const activated = responseBody<{ token: string; installationId: string; unitId: string }>(await activate(ticket).expect(201))
    expect(activated.unitId).toBe(unitId); expect(activated.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(responseBody<{ token: string }>(await activate(ticket).expect(201)).token).toBe(activated.token)
    await activate(ticket, randomUUID()).expect(401)
    const [stored] = await f.database.query<Array<{ encrypted_token: string }>>('SELECT encrypted_token FROM router_installations WHERE id=$1', [activated.installationId])
    expect(stored!.encrypted_token).not.toContain(activated.token)
    const heartbeat = { version: '0.5.0', pending: 0, failed: 0, freeBytes: 10000000000 }
    await request(f.server).post('/api/v1/dicom-agent/heartbeat').set('Authorization', 'Bearer ' + activated.token).send(heartbeat).expect(403)
    await request(secure).post('/api/v1/dicom-agent/heartbeat').ca(certificate).set('Authorization', 'Bearer ' + activated.token).send(heartbeat).expect(201)
    const units = responseBody<Array<{ id: string; router: { status: string; installed: number } }>>(await f.api('get', '/hospital-units/admin').expect(200))
    expect(units.find(unit => unit.id === unitId)?.router).toMatchObject({ status: 'ONLINE', installed: 1 })
    await request(secure).post('/api/v1/dicom-agent/uploads').ca(certificate).set('Authorization', 'Bearer ' + activated.token).send({ kind: 'DICOM', unitId: f.secondUnit, name: 'synthetic.dcm', contentType: 'application/dicom', sizeBytes: 132, sha256: 'a'.repeat(64) }).expect(400)
    await f.database.query("UPDATE dicom_sources SET last_seen_at=now()-interval '120 seconds' WHERE id=(SELECT source_id FROM router_installations WHERE id=$1)", [activated.installationId])
    const offline = responseBody<Array<{ id: string; router: { status: string } }>>(await f.api('get', '/hospital-units/admin').expect(200))
    expect(offline.find(unit => unit.id === unitId)?.router.status).toBe('OFFLINE')
    const reinstalled = responseBody<{ token: string; installationId: string }>(await activate(await download()).expect(201))
    expect(reinstalled.installationId).toBe(activated.installationId); expect(reinstalled.token).not.toBe(activated.token)
    await request(secure).post('/api/v1/dicom-agent/heartbeat').ca(certificate).set('Authorization', 'Bearer ' + activated.token).send(heartbeat).expect(401)
    await f.database.query("UPDATE router_installer_tickets SET expires_at=now()-interval '1 minute' WHERE id=$1", [ticket.ticketId])
    await activate(ticket).expect(401)
  })
})
