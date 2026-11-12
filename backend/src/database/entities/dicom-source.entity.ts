import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
@Entity({ name: 'dicom_sources' })
export class DicomSourceEntity {
  @Column({ name: 'requires_tls', type: 'boolean', default: false }) requiresTls: boolean
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid' }) unitId: string
  @Column({ type: 'varchar', length: 120 }) name: string
  @Column({ name: 'token_hash', type: 'varchar', length: 64 }) tokenHash: string
  @Column({ type: 'boolean', default: true }) active: boolean
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId: string
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true }) lastSeenAt: Date | null
  @Column({ type: 'jsonb', default: {} }) diagnostics: Record<string, unknown>
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
}
