import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import type { CreateExamDto } from '../../modules/exams/dto/create-exam.dto'

@Entity({ name: 'hospital_intakes' })
export class HospitalIntakeEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid' }) unitId: string
  @Column({ name: 'study_uid', type: 'varchar', length: 64 }) studyUid: string
  @Column({ name: 'identity_hash', type: 'varchar', length: 64 }) identityHash: string
  @Column({ type: 'varchar', length: 20, default: 'DRAFT' }) status: 'DRAFT' | 'SUBMITTED'
  @Column({ type: 'integer', default: 0 }) version: number
  @Column({ type: 'jsonb', default: {} }) fields: Partial<CreateExamDto>
  @Column({ name: 'submitted_fields', type: 'jsonb', nullable: true }) submittedFields: Partial<CreateExamDto> | null
  @Column({ type: 'jsonb', default: [] }) issues: string[]
  @Column({ name: 'exam_id', type: 'uuid', nullable: true }) examId: string | null
  @Column({ name: 'recipient_company_id', type: 'uuid', nullable: true }) recipientCompanyId: string | null
  @Column({ name: 'recipient_unit_id', type: 'uuid', nullable: true }) recipientUnitId: string | null
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt: Date | null
  @Column({ name: 'submitted_by_user_id', type: 'uuid', nullable: true }) submittedByUserId: string | null
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date
}
