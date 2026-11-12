import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'node:crypto'
import type { AccessTokenClaims } from './auth.contracts'

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  get ttlSeconds(): number {
    return this.configService.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS')
  }

  sign(userId: string, sessionId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sid: sessionId },
      {
        algorithm: 'RS256',
        issuer: this.configService.getOrThrow<string>('JWT_ISSUER'),
        audience: this.configService.getOrThrow<string>('JWT_AUDIENCE'),
        subject: userId,
        jwtid: randomUUID(),
        expiresIn: this.ttlSeconds,
      },
    )
  }

  verify(token: string): Promise<AccessTokenClaims> {
    return this.jwtService.verifyAsync<AccessTokenClaims>(token, {
      algorithms: ['RS256'],
      issuer: this.configService.getOrThrow<string>('JWT_ISSUER'),
      audience: this.configService.getOrThrow<string>('JWT_AUDIENCE'),
    })
  }
}
