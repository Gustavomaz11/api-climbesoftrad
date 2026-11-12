import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { AuthSessionEntity } from './auth-session.entity'
import { OAuthAuthorizationCodeEntity } from './oauth-authorization-code.entity'
import { AccessRoleEntity } from './access-role.entity'

export type UserStatus = 'ACTIVE' | 'DISABLED'
export type UserRole = 'USER' | 'ADMIN' | 'DOCTOR'

@Entity({ name: 'auth_users' })
export class AuthUserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'citext', unique: true })
  email: string

  @Column({ type: 'citext', unique: true, nullable: true })
  username: string | null

  @Column({ name: 'full_name', type: 'varchar', length: 120 })
  fullName: string

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: UserStatus

  @Column({ type: 'varchar', length: 20, default: 'USER' })
  role: UserRole

  @Column({ name: 'access_role_id', type: 'uuid' })
  accessRoleId: string

  @ManyToOne(() => AccessRoleEntity, (accessRole) => accessRole.users, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'access_role_id' })
  accessRole: AccessRoleEntity

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean

  @Column({ name: 'failed_login_attempts', type: 'integer', default: 0 })
  failedLoginAttempts: number

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date

  @OneToMany(() => OAuthAuthorizationCodeEntity, (authorizationCode) => authorizationCode.user)
  authorizationCodes: OAuthAuthorizationCodeEntity[]

  @OneToMany(() => AuthSessionEntity, (session) => session.user)
  sessions: AuthSessionEntity[]
}
