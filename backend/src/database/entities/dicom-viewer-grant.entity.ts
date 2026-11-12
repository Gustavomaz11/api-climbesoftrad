import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'
import type { CompanyAccessContext } from '../../modules/companies/company-context.contracts'
@Entity({ name: 'dicom_viewer_grants' })
export class DicomViewerGrantEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'token_hash', type: 'varchar', length: 64 }) tokenHash: string
  @Column({ type: 'jsonb' }) context: CompanyAccessContext
  @Column({ name: 'study_ids', type: 'uuid', array: true }) studyIds: string[]
  @Column({ name: 'intake_id', type: 'uuid', nullable: true }) intakeId: string | null
  @Column({ name: 'upload_ids', type: 'uuid', array: true, default: '{}' }) uploadIds: string[]
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date
}
