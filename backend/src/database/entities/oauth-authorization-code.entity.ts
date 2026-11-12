import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { AuthUserEntity } from './auth-user.entity'
import { OAuthClientEntity } from './oauth-client.entity'

@Entity({ name: 'oauth_authorization_codes' })
export class OAuthAuthorizationCodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'code_hash', type: 'char', length: 64, unique: true })
  codeHash: string

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string

  @ManyToOne(() => AuthUserEntity, (user) => user.authorizationCodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AuthUserEntity

  @Column({ name: 'client_id', type: 'varchar', length: 100 })
  clientId: string

  @ManyToOne(() => OAuthClientEntity, (client) => client.authorizationCodes, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'client_id' })
  client: OAuthClientEntity

  @Column({ name: 'code_challenge', type: 'varchar', length: 128 })
  codeChallenge: string

  @Column({ name: 'code_challenge_method', type: 'varchar', length: 10 })
  codeChallengeMethod: 'S256'

  @Column({ name: 'remember_access', type: 'boolean', default: false })
  rememberAccess: boolean

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
