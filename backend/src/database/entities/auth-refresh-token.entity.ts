import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { AuthSessionEntity } from './auth-session.entity'

@Entity({ name: 'auth_refresh_tokens' })
export class AuthRefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string

  @ManyToOne(() => AuthSessionEntity, (session) => session.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: AuthSessionEntity

  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
  tokenHash: string

  @Column({ name: 'parent_token_id', type: 'uuid', nullable: true })
  parentTokenId: string | null

  @ManyToOne(() => AuthRefreshTokenEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_token_id' })
  parentToken: AuthRefreshTokenEntity | null

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
