import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createReadStream } from 'node:fs'
import { createConnection } from 'node:net'
import { once } from 'node:events'

export class ValidationUnavailable extends Error {}
@Injectable()
export class ClamAvScanner {
  constructor(private readonly config: ConfigService) {}
  async scan(path: string): Promise<'CLEAN' | 'INFECTED'> {
    const host = this.config.get<string>('CLAMAV_HOST')
    if (!host) throw new ValidationUnavailable('Varredura ainda não configurada.')
    const socket = createConnection({ host, port: this.config.getOrThrow<number>('CLAMAV_PORT') })
    socket.setTimeout(120000, () => socket.destroy(new Error('Varredura indisponível.')))
    const response = new Promise<string>((resolve, reject) => {
      let result = ''
      socket.on('data', (chunk: Buffer) => {
        result += chunk.toString()
        if (result.length > 4096) socket.destroy(new Error('Resposta inválida.'))
      })
      socket.on('end', () => resolve(result))
      socket.on('error', reject)
    })
    // Observe rejection immediately while file chunks are being sent.
    void response.catch(() => {})
    const file = createReadStream(path, { highWaterMark: 64 * 1024 })
    try {
      await once(socket, 'connect')
      socket.write('zINSTREAM\0')
      for await (const chunk of file) {
        const bytes = chunk as Buffer
        const header = Buffer.alloc(4)
        header.writeUInt32BE(bytes.length)
        if (!socket.write(Buffer.concat([header, bytes]))) await once(socket, 'drain')
      }
      socket.write(Buffer.alloc(4))
      const result = (await response).replaceAll('\0', '').trim()
      if (result.endsWith(' FOUND')) return 'INFECTED'
      if (result.endsWith(' OK')) return 'CLEAN'
      throw new ValidationUnavailable('Varredura não concluiu a análise.')
    } catch {
      throw new ValidationUnavailable('Serviço de varredura indisponível.')
    } finally {
      file.destroy()
      socket.destroy()
    }
  }
}
