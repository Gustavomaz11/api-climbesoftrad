import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, unlink, rmdir, statfs } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ClamAvScanner, ValidationUnavailable } from './clamav-scanner.service'
import { inspectDicom, inspectDocument } from './file-format-inspector'
import { mapDicomMetadata } from '../dicom/dicom-metadata.policy'
import { R2MultipartStorage } from './r2-multipart-storage.service'

export class InvalidUploadedFile extends Error {}
@Injectable()
export class FileValidationService {
  constructor(
    private readonly storage: R2MultipartStorage,
    private readonly scanner: ClamAvScanner,
  ) {}
  async stored(input: {
    storageKey: string
    kind: string
    sizeBytes: number
    sha256: string
    contentType: string
  }) {
    return this.inspect(await this.storage.stream(input.storageKey), input)
  }
  async buffered(bytes: Buffer, contentType: string) {
    return this.inspect(Readable.from(bytes), {
      kind: 'ATTACHMENT',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      contentType,
    })
  }
  private async inspect(
    stream: Readable,
    input: { kind: string; sizeBytes: number; sha256: string; contentType: string },
  ) {
    const space = await statfs(tmpdir())
    if (space.bavail * space.bsize < input.sizeBytes + 128 * 1024 * 1024) {
      stream.destroy()
      throw new ValidationUnavailable('Espaço insuficiente para validação.')
    }
    const directory = await mkdtemp(join(tmpdir(), 'sourad-validation-')),
      path = join(directory, 'payload')
    let size = 0
    const hash = createHash('sha256')
    const checker = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > input.sizeBytes) {
          callback(new InvalidUploadedFile('Tamanho total divergente.'))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(stream, checker, createWriteStream(path, { flags: 'wx' }))
      if (size !== input.sizeBytes || hash.digest('hex') !== input.sha256)
        throw new InvalidUploadedFile('Integridade ou tamanho divergente.')
      let metadata:
        | (ReturnType<typeof mapDicomMetadata> & { tags: Awaited<ReturnType<typeof inspectDicom>> })
        | undefined
      try {
        if (input.kind === 'DICOM') {
          const tags = await inspectDicom(path)
          metadata = { ...mapDicomMetadata(tags), tags }
        } else await inspectDocument(path, input.contentType)
      } catch {
        throw new InvalidUploadedFile(
          'Conteúdo inválido, formato incompatível ou cabeçalho DICOM não suportado.',
        )
      }
      if ((await this.scanner.scan(path)) !== 'CLEAN')
        throw new InvalidUploadedFile('Arquivo rejeitado pela varredura.')
      return metadata ?? null
    } finally {
      stream.destroy()
      await unlink(path).catch(() => {})
      await rmdir(directory)
    }
  }
}
