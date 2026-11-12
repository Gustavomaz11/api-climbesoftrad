import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
@Entity({ name: 'dicom_reviews' })
export class DicomReviewEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid' }) unitId: string
  @Column({ name: 'upload_id', type: 'uuid' }) uploadId: string
  @Column({ name: 'exam_id', type: 'uuid', nullable: true }) examId: string | null
  @Column({ type: 'varchar', length: 40 }) kind:
    'DEMOGRAPHICS' | 'IDENTITY_COLLISION' | 'POSSIBLE_DUPLICATE'
  @Column({ type: 'jsonb' }) details: Record<string, unknown>
  @Column({ type: 'varchar', length: 20, default: 'OPEN' }) status: 'OPEN' | 'RESOLVED'
  @Column({ type: 'integer', default: 0 }) version: number
  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true }) resolvedByUserId:
    string | null
  @Column({ name: 'resolution_reason', type: 'varchar', length: 500, nullable: true })
  resolutionReason: string | null
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
}
