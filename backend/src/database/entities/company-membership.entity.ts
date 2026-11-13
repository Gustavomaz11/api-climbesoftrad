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
import type { PortalKind } from '../../modules/companies/portal-access'
import { AuthUserEntity } from './auth-user.entity'
import { AccessRoleEntity } from './access-role.entity'
import { CompanyEntity } from './company.entity'
import { CompanyMembershipUnitEntity } from './company-membership-unit.entity'

@Entity({ name: 'company_memberships' })
export class CompanyMembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string

  @Column({ name: 'access_role_id', type: 'uuid' })
  accessRoleId: string

  @Column({ type: 'boolean', default: true })
  active: boolean

  @Column({ name: 'allowed_portals', type: 'varchar', array: true, default: () => "ARRAY['sourad']::varchar[]" })
  allowedPortals: PortalKind[]

  @Column({ name: 'all_units', type: 'boolean', default: false })
  allUnits: boolean

  @Column({ name: 'preferences_version', type: 'integer', default: 0 })
  preferencesVersion: number

  @Column({ name: 'signature_text', type: 'varchar', length: 500, nullable: true })
  signatureText: string | null

  @ManyToOne(() => CompanyEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_id' })
  company: CompanyEntity

  @ManyToOne(() => AuthUserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: AuthUserEntity

  @ManyToOne(() => AccessRoleEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'access_role_id' })
  accessRole: AccessRoleEntity

  @OneToMany(() => CompanyMembershipUnitEntity, (link) => link.membership)
  unitLinks: CompanyMembershipUnitEntity[]

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
