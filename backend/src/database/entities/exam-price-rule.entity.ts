import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
@Entity({ name: 'exam_price_rules' })
export class ExamPriceRuleEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid', nullable: true }) unitId: string | null
  @Column({ name: 'physician_id', type: 'uuid', nullable: true }) physicianId: string | null
  @Column({ name: 'exam_type_id', type: 'uuid' }) examTypeId: string
  @Column({ type: 'varchar', length: 10 }) modality: string
  @Column({ type: 'varchar', length: 10 }) kind: 'BILLING' | 'PAYOUT'
  @Column({ type: 'varchar', length: 3, default: 'BRL' }) currency: string
  @Column({ name: 'amount_cents', type: 'bigint' }) amountCents: string
  @Column({ name: 'valid_from', type: 'date' }) validFrom: string
  @Column({ name: 'valid_to', type: 'date', nullable: true }) validTo: string | null
  @Column({ type: 'integer', default: 0 }) version: number
  @Column({ type: 'varchar', length: 500 }) reason: string
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId: string
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
}
