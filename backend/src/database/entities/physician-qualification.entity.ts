import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { ExamTypeEntity } from './exam-type.entity'
import { HospitalUnitEntity } from './hospital-unit.entity'
import { CompanyMembershipEntity } from './company-membership.entity'
import { PhysicianEntity } from './physician.entity'

@Entity({ name: 'physician_qualifications' })
export class PhysicianQualificationEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'membership_id', type: 'uuid' }) membershipId: string
  @Column({ name: 'physician_id', type: 'uuid' }) physicianId: string
  @Column({ name: 'user_id', type: 'uuid' }) userId: string
  @Column({ name: 'unit_id', type: 'uuid' }) unitId: string
  @Column({ name: 'exam_type_id', type: 'uuid' }) examTypeId: string
  @Column({ type: 'varchar', length: 10 }) modality: string
  @Column({ type: 'boolean', default: true }) active: boolean
  @Column({ type: 'integer', default: 0 }) version: number
  @Column({ type: 'varchar', length: 500 }) reason: string
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId: string
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
  @ManyToOne(() => ExamTypeEntity) @JoinColumn({ name: 'exam_type_id' }) examType: ExamTypeEntity
  @ManyToOne(() => HospitalUnitEntity) @JoinColumn({ name: 'unit_id' }) unit: HospitalUnitEntity
  @ManyToOne(() => CompanyMembershipEntity)
  @JoinColumn({ name: 'membership_id' })
  membership: CompanyMembershipEntity
  @ManyToOne(() => PhysicianEntity) @JoinColumn({ name: 'physician_id' }) physician: PhysicianEntity
}
