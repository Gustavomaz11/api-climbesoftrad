import { ConfigService } from '@nestjs/config'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { FileValidationService } from './file-validation.service'
import { ClamAvScanner, ValidationUnavailable } from './clamav-scanner.service'
import type { R2MultipartStorage } from './r2-multipart-storage.service'
import { syntheticDicom, syntheticPdf } from '../../../test/synthetic-documents'
describe('Structural file validation and fail-closed scanning', () => {
  const scanner = { scan: jest.fn(() => Promise.resolve('CLEAN')) }
  const storage = { stream: jest.fn(() => Promise.resolve(Readable.from('invalid'))) }
  const service = new FileValidationService(
    storage as unknown as R2MultipartStorage,
    scanner as unknown as ClamAvScanner,
  )
  beforeEach(() => scanner.scan.mockReset().mockResolvedValue('CLEAN'))
  it('requires real PDF structure and rejects disguised content', async () => {
    await expect(
      service.buffered(Buffer.from('%PDF-1.7\nnot a document'), 'application/pdf'),
    ).rejects.toThrow('Conteúdo inválido')
    await expect(service.buffered(await syntheticPdf(), 'application/pdf')).resolves.toBeNull()
  })
  it('never approves an unavailable or infected scan', async () => {
    scanner.scan.mockRejectedValueOnce(new ValidationUnavailable('offline'))
    await expect(service.buffered(await syntheticPdf(), 'application/pdf')).rejects.toThrow(
      'offline',
    )
    scanner.scan.mockResolvedValueOnce('INFECTED')
    await expect(service.buffered(await syntheticPdf(), 'application/pdf')).rejects.toThrow(
      'varredura',
    )
    await expect(new ClamAvScanner(new ConfigService({})).scan('unused')).rejects.toThrow(
      'não configurada',
    )
  })
  it('rejects truncated DICOM pixel data without buffering an entire study', async () => {
    const bytes = syntheticDicom().subarray(0, -1)
    storage.stream.mockResolvedValueOnce(Readable.from(bytes))
    await expect(
      service.stored({
        storageKey: 'test',
        kind: 'DICOM',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        contentType: 'application/dicom',
      }),
    ).rejects.toThrow('Conteúdo inválido')
  })
})
