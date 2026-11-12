import { CryptoService } from './crypto.service'

describe('CryptoService', () => {
  const service = new CryptoService()

  it('gera tokens opacos com pelo menos 256 bits de entropia', () => {
    const first = service.createOpaqueToken()
    const second = service.createOpaqueToken()

    expect(first).toHaveLength(43)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('calcula challenge PKCE S256 em Base64URL sem padding', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(service.createPkceChallenge(verifier)).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('cria e verifica hash Argon2id sem preservar a senha', async () => {
    const password = 'uma senha longa e segura'
    const hash = await service.hashPassword(password)

    expect(hash).toContain('$argon2id$')
    expect(hash).not.toContain(password)
    await expect(service.verifyPassword(hash, password)).resolves.toBe(true)
    await expect(service.verifyPassword(hash, 'senha incorreta')).resolves.toBe(false)
  })
})
