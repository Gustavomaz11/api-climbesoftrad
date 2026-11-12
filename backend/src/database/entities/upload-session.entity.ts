import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
import type { CompanyAccessContext } from '../../modules/companies/company-context.contracts'

export type UploadStatus =
  | 'UPLOADING'
  | 'RECEIVED'
  | 'VALIDATING'
  | 'APPROVED'
  | 'AWAITING_REVIEW'
  | 'FORWARDED'
  | 'QUARANTINED'
  | 'REJECTED'
  | 'PUBLISHED'
  | 'CANCELLED'
  | 'EXPIRED'
@Entity({ name: 'upload_sessions' })
export class UploadSessionEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid' }) unitId: string
  @Column({ name: 'exam_id', type: 'uuid', nullable: true }) examId: string | null
  @Column({ name: 'source_id', type: 'uuid', nullable: true }) sourceId: string | null
  @Column({ name: 'intake_id', type: 'uuid', nullable: true }) intakeId: string | null
  @Column({ name: 'origin_upload_id', type: 'uuid', nullable: true }) originUploadId: string | null
  @Column({ name: 'forwarded_upload_id', type: 'uuid', nullable: true }) forwardedUploadId: string | null
  @Column({ name: 'preview_orthanc_id', type: 'varchar', length: 64, nullable: true }) previewOrthancId: string | null
  @Column({ type: 'varchar', length: 20 }) kind: 'ATTACHMENT' | 'DICOM'
  @Column({ type: 'varchar', length: 255 }) name: string
  @Column({ name: 'content_type', type: 'varchar', length: 120 }) contentType: string
  @Column({ name: 'size_bytes', type: 'integer' }) sizeBytes: number
  @Column({ type: 'varchar', length: 64 }) sha256: string
  @Column({ name: 'storage_key', type: 'varchar', length: 500 }) storageKey: string
  @Column({ name: 'multipart_id', type: 'varchar', length: 500 }) multipartId: string
  @Column({ type: 'varchar', length: 20 }) status: UploadStatus
  @Column({ type: 'jsonb', default: {} }) payload: Record<string, unknown>
  @Column({ type: 'jsonb' }) context: CompanyAccessContext
  @Column({ name: 'result_id', type: 'uuid', nullable: true }) resultId: string | null
  @Column({ name: 'validation_reason', type: 'varchar', length: 500, nullable: true })
  validationReason: string | null
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true }) leaseUntil: Date | null
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
}
