import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'patient_reviews' })
export class PatientReviewEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string

  @Column({ name: 'exam_id', type: 'uuid', nullable: true })
  examId: string | null

  @Column({ name: 'kind', type: 'varchar', length: 30 })
  kind: string

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: string

  @Column({ name: 'version', type: 'integer' })
  version: number

  @Column({ name: 'candidates', type: 'jsonb' })
  candidates: Array<{ patientId: string; confidence: string; reasons: string[] }>

  @Column({ name: 'differences', type: 'jsonb' })
  differences: string[]

  @Column({ name: 'reason', type: 'varchar', length: 500, nullable: true })
  reason: string | null

  @Column({ name: 'decision_id', type: 'uuid', nullable: true })
  decisionId: string | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
