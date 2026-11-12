import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'patient_import_batches' })
export class PatientImportBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'name', type: 'varchar', length: 120 })
  name: string

  @Column({ name: 'content_hash', type: 'varchar', length: 64 })
  contentHash: string

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: string

  @Column({ name: 'unit_ids', type: 'jsonb' })
  unitIds: string[]

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
