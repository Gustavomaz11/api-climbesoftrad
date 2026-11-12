import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
export interface ContrastProtocolField {
  key: string
  label: string
  kind: 'TEXT' | 'NUMBER'
  unit: string
  required: boolean
}
@Entity({ name: 'contrast_protocols' })
export class ContrastProtocolEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid', nullable: true }) unitId: string | null
  @Column({ name: 'exam_type_id', type: 'uuid' }) examTypeId: string
  @Column({ type: 'varchar', length: 10 }) modality: string
  @Column({ name: 'family_id', type: 'uuid' }) familyId: string
  @Column({ type: 'integer' }) version: number
  @Column({ name: 'state_version', type: 'integer', default: 0 }) stateVersion: number
  @Column({ type: 'varchar', length: 20 }) status: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  @Column({ type: 'varchar', length: 180 }) name: string
  @Column({ type: 'text' }) template: string
  @Column({ type: 'jsonb' }) fields: ContrastProtocolField[]
  @Column({ type: 'varchar', length: 2000 }) notes: string
  @Column({ name: 'approval_reference', type: 'varchar', length: 500, nullable: true })
  approvalReference: string | null
  @Column({ name: 'approved_by_physician_id', type: 'uuid', nullable: true })
  approvedByPhysicianId: string | null
  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true }) activatedAt: Date | null
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId: string
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
}
