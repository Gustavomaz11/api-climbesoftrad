import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { AccessPermissionEntity } from './access-permission.entity'
import { AuthUserEntity } from './auth-user.entity'

@Entity({ name: 'access_roles' })
export class AccessRoleEntity {
  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 80 })
  code: string

  @Column({ type: 'varchar', length: 120 })
  name: string

  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null

  @Column({ type: 'boolean', default: true })
  active: boolean

  @Column({ type: 'boolean', default: false })
  immutable: boolean

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date

  @ManyToMany(() => AccessPermissionEntity, (permission) => permission.roles)
  @JoinTable({
    name: 'access_role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_code', referencedColumnName: 'code' },
  })
  permissions: AccessPermissionEntity[]

  @OneToMany(() => AuthUserEntity, (user) => user.accessRole)
  users: AuthUserEntity[]
}
