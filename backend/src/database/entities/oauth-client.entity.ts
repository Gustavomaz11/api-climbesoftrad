import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn } from 'typeorm'
import { AuthSessionEntity } from './auth-session.entity'
import { OAuthAuthorizationCodeEntity } from './oauth-authorization-code.entity'

@Entity({ name: 'oauth_clients' })
export class OAuthClientEntity {
  @PrimaryColumn({ name: 'client_id', type: 'varchar', length: 100 })
  clientId: string

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName: string

  @Column({ type: 'boolean', default: true })
  enabled: boolean

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @OneToMany(() => OAuthAuthorizationCodeEntity, (authorizationCode) => authorizationCode.client)
  authorizationCodes: OAuthAuthorizationCodeEntity[]

  @OneToMany(() => AuthSessionEntity, (session) => session.client)
  sessions: AuthSessionEntity[]
}
