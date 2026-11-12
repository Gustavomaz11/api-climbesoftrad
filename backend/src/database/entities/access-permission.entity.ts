import { Column, CreateDateColumn, Entity, ManyToMany, PrimaryColumn } from 'typeorm'
import { AccessRoleEntity } from './access-role.entity'

@Entity({ name: 'access_permissions' })
export class AccessPermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  code: string

  @Column({ name: 'group_name', type: 'varchar', length: 80 })
  group: string

  @Column({ type: 'varchar', length: 120 })
  name: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @ManyToMany(() => AccessRoleEntity, (role) => role.permissions)
  roles: AccessRoleEntity[]
}
