import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { AuthRefreshTokenEntity } from './auth-refresh-token.entity'
import { AuthUserEntity } from './auth-user.entity'
import { OAuthClientEntity } from './oauth-client.entity'

export type SessionRevocationReason =
  | 'LOGOUT'
  | 'REFRESH_TOKEN_REUSE'
  | 'EXPIRED'
  | 'ACCOUNT_DISABLED'
  | 'ROLE_DISABLED'
  | 'ROLE_CHANGED'

@Entity({ name: 'auth_sessions' })
export class AuthSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string

  @ManyToOne(() => AuthUserEntity, (user) => user.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AuthUserEntity

  @Column({ name: 'client_id', type: 'varchar', length: 100 })
  clientId: string

  @ManyToOne(() => OAuthClientEntity, (client) => client.sessions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client: OAuthClientEntity

  @Column({ name: 'token_family_id', type: 'uuid' })
  tokenFamilyId: string

  @Column({ type: 'boolean', default: false })
  persistent: boolean

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null

  @Column({ name: 'revocation_reason', type: 'varchar', length: 40, nullable: true })
  revocationReason: SessionRevocationReason | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @OneToMany(() => AuthRefreshTokenEntity, (refreshToken) => refreshToken.session)
  refreshTokens: AuthRefreshTokenEntity[]
}
