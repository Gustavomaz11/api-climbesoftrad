// Smoke test with synthetic bytes; no patients or exams are created.
require('reflect-metadata')
const { resolve, join } = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { mkdtemp, writeFile, unlink, rmdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { ConfigService } = require('@nestjs/config')
const { DeleteObjectCommand } = require('@aws-sdk/client-s3')
const root = resolve(__dirname, '..')
require('dotenv').config({ path: join(root, '.env'), quiet: true })
const { validateEnvironment } = require(join(root, 'dist/config/environment'))
const { R2ObjectStorage } = require(join(root, 'dist/modules/exams/r2-object-storage.service'))
const { R2MultipartStorage } = require(join(root, 'dist/modules/file-validation/r2-multipart-storage.service'))
const { ClamAvScanner } = require(join(root, 'dist/modules/file-validation/clamav-scanner.service'))
const { OrthancArchiveService } = require(join(root, 'dist/modules/dicom/orthanc-archive.service'))

const verify = async () => {
  const config = new ConfigService(validateEnvironment({ ...process.env, NODE_ENV: 'development' }))
  const objects = new R2ObjectStorage(config), multipart = new R2MultipartStorage(objects)
  const scanner = new ClamAvScanner(config), archive = new OrthancArchiveService(config)
  const directory = await mkdtemp(join(tmpdir(), 'sourad-connectivity-')), path = join(directory, 'synthetic.txt')
  const bytes = Buffer.from('SouRad synthetic connectivity verification ' + randomUUID())
  const key = 'qa-connectivity/' + randomUUID()
  const copyKey = key + '-copy'
  let uploadId, stored = false
  try {
    await writeFile(path, bytes)
    const scan = await scanner.scan(path)
    if (scan !== 'CLEAN') throw new Error('Synthetic file was not approved by the scanner.')
    await archive.request('/system')
    uploadId = await multipart.begin(key, 'text/plain', createHash('sha256').update(bytes).digest('hex'))
    await multipart.putPart(key, uploadId, 1, bytes)
    await multipart.complete(key, uploadId, await multipart.parts(key, uploadId))
    stored = true
    if (await objects.readText(key) !== bytes.toString()) throw new Error('Storage integrity check failed.')
    await objects.copy(key, copyKey)
    if (await objects.readText(copyKey) !== bytes.toString()) throw new Error('Copy integrity check failed.')
    console.log(JSON.stringify({ scanner: scan, archive: 'CONNECTED', storage: 'MULTIPART_AND_INTEGRITY_OK', forwarding: 'SERVER_COPY_OK' }))
  } finally {
    if (stored) await objects.getClient().send(new DeleteObjectCommand({ Bucket: objects.bucket, Key: key }))
    else if (uploadId) await multipart.abort(key, uploadId)
    await objects.getClient().send(new DeleteObjectCommand({ Bucket: objects.bucket, Key: copyKey }))
    await unlink(path).catch(() => {})
    await rmdir(directory).catch(() => {})
  }
}
verify().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1 })
