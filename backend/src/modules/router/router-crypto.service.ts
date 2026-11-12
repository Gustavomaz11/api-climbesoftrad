import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, createHash, randomBytes, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

@Injectable()
export class RouterCryptoService {
  constructor(private readonly config: ConfigService) {}
  private get privateKey() { return readFileSync(this.config.getOrThrow<string>('JWT_PRIVATE_KEY_PATH')) }
  private get encryptionKey() { return createHash('sha256').update(this.config.get<string>('ROUTER_CREDENTIAL_SECRET') || this.privateKey).digest() }
  seal(token: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv)
    const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
  }
  unseal(value: string) {
    const bytes = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
  }
  envelope(manifest: object) {
    const body = Buffer.from(JSON.stringify(manifest))
    return Buffer.from(JSON.stringify({ payload: body.toString('base64'), signature: sign('RSA-SHA256', body, this.privateKey).toString('base64') }))
  }
}
