import { Injectable } from '@nestjs/common'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import * as argon2 from 'argon2'

const passwordHashOptions: argon2.Options & { type: number } = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
}

@Injectable()
export class CryptoService {
  createOpaqueToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url')
  }

  sha256Hex(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }

  createPkceChallenge(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
  }

  safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8')
    const rightBuffer = Buffer.from(right, 'utf8')

    if (leftBuffer.length !== rightBuffer.length) {
      return false
    }

    return timingSafeEqual(leftBuffer, rightBuffer)
  }

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, passwordHashOptions)
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password)
    } catch {
      return false
    }
  }
}
