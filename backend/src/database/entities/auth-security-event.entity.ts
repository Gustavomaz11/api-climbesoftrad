import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

export type SecurityEventType =
  | 'REGISTER_SUCCESS'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'ACCOUNT_TEMPORARILY_LOCKED'
  | 'TOKEN_EXCHANGED'
  | 'TOKEN_REFRESHED'
  | 'REFRESH_TOKEN_REUSE_DETECTED'
  | 'LOGOUT'
  | 'INVALID_PKCE'

@Entity({ name: 'auth_security_events' })
export class AuthSecurityEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType: SecurityEventType

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress: string | null

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  userAgent: string | null

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, string | number | boolean | null>

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
