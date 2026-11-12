import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const outputDirectory = resolve(process.cwd(), 'secrets')
mkdirSync(outputDirectory, { recursive: true })

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

writeFileSync(resolve(outputDirectory, 'jwt_private.pem'), privateKey, { mode: 0o600 })
writeFileSync(resolve(outputDirectory, 'jwt_public.pem'), publicKey, { mode: 0o600 })

process.stdout.write('Chaves JWT locais geradas em backend/secrets/.\n')
