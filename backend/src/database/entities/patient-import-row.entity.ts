export interface ImportedIdentifierRow {
  unitId: string
  issuer: string
  externalId: string
  patientId: string
  legacyIssuer: string
  legacyExternalId: string
}
import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'patient_import_rows' })
export class PatientImportRowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string

  @Column({ name: 'line', type: 'integer' })
  line: number

  @Column({ name: 'data', type: 'jsonb' })
  data: ImportedIdentifierRow

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: string

  @Column({ name: 'included', type: 'boolean' })
  included: boolean

  @Column({ name: 'message', type: 'varchar', length: 500, nullable: true })
  message: string | null

  @Column({ name: 'version', type: 'integer' })
  version: number

  @Column({ name: 'result', type: 'jsonb', nullable: true })
  result: Record<string, unknown> | unknown[] | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
