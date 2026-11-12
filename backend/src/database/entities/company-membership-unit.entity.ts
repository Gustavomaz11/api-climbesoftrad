import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm'
import { CompanyMembershipEntity } from './company-membership.entity'
import { HospitalUnitEntity } from './hospital-unit.entity'

@Entity({ name: 'company_membership_units' })
export class CompanyMembershipUnitEntity {
  @PrimaryColumn({ name: 'membership_id', type: 'uuid' })
  membershipId: string

  @PrimaryColumn({ name: 'unit_id', type: 'uuid' })
  unitId: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ type: 'boolean', default: true })
  active: boolean

  @ManyToOne(() => CompanyMembershipEntity, (membership) => membership.unitLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'membership_id' })
  membership: CompanyMembershipEntity

  @ManyToOne(() => HospitalUnitEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unit_id' })
  unit: HospitalUnitEntity
}
