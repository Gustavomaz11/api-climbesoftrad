import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
@Injectable()
export class OrthancArchiveService {
  constructor(private readonly config: ConfigService) {}
  get configured() {
    return Boolean(this.config.get<string>('ORTHANC_INTERNAL_URL'))
  }
  async request(path: string, init: RequestInit = {}) {
    const root = this.config.get<string>('ORTHANC_INTERNAL_URL')
    if (!root) throw new ServiceUnavailableException('Arquivo DICOMweb não configurado.')
    const headers = new Headers(init.headers)
    headers.set(
      'Authorization',
      'Basic ' +
        Buffer.from(
          `${this.config.get<string>('ORTHANC_USERNAME')}:${this.config.get<string>('ORTHANC_PASSWORD')}`,
        ).toString('base64'),
    )
    const response = await fetch(root.replace(/\/$/, '') + path, {
      ...init,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    })
    if (!response.ok) throw new ServiceUnavailableException('Arquivo DICOMweb indisponível.')
    return response
  }
  async store(stream: Readable, sha256: string) {
    try {
      const response = await this.request('/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/dicom' },
        body: stream as unknown as BodyInit,
        duplex: 'half',
      } as RequestInit)
      const result = (await response.json()) as { ID?: string }
      if (!result.ID) throw new ServiceUnavailableException('Arquivo DICOM não confirmado.')
      // Orthanc can recognize an existing global SOP UID from another scoped upload.
      // Confirm the stored bytes, so a UID collision never publishes the wrong instance.
      const stored = await this.request(`/instances/${result.ID}/file`)
      if (!stored.body)
        throw new ServiceUnavailableException('Integridade do arquivo DICOM não confirmada.')
      const hash = createHash('sha256')
      for await (const chunk of stored.body) hash.update(chunk)
      if (hash.digest('hex') !== sha256)
        throw new ServiceUnavailableException('Colisão no arquivo DICOM. Conferência necessária.')
      return result.ID
    } finally {
      stream.destroy()
    }
  }
}
