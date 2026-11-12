import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
@Entity({ name: 'dicom_studies' })
export class DicomStudyEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid' }) unitId: string
  @Column({ name: 'exam_id', type: 'uuid' }) examId: string
  @Column({ name: 'study_uid', type: 'varchar', length: 64 }) studyUid: string
  @Column({ name: 'identity_hash', type: 'varchar', length: 64 }) identityHash: string
  @Column({ name: 'last_received_at', type: 'timestamptz' }) lastReceivedAt: Date
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null
  @Column({ name: 'completion_reason', type: 'varchar', length: 100, nullable: true })
  completionReason: string | null
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
}
