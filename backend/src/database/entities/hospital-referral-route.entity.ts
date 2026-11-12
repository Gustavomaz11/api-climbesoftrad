import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'hospital_referral_routes' })
export class HospitalReferralRouteEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid' }) unitId: string
  @Column({ name: 'recipient_company_id', type: 'uuid' }) recipientCompanyId: string
  @Column({ name: 'recipient_unit_id', type: 'uuid' }) recipientUnitId: string
  @Column({ type: 'boolean', default: true }) active: boolean
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId: string
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
}
