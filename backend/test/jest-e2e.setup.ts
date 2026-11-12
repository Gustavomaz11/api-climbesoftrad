import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const keyDirectory = resolve(process.cwd(), 'test/.tmp')
mkdirSync(keyDirectory, { recursive: true })

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

writeFileSync(resolve(keyDirectory, 'jwt_private.pem'), privateKey, { mode: 0o600 })
writeFileSync(resolve(keyDirectory, 'jwt_public.pem'), publicKey, { mode: 0o600 })
