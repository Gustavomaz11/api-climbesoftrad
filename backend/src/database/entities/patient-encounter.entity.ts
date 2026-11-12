import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'patient_encounters' })
export class PatientEncounterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string

  @Column({ name: 'issuer', type: 'varchar', length: 120, nullable: true })
  issuer: string | null

  @Column({ name: 'external_id', type: 'varchar', length: 120, nullable: true })
  externalId: string | null

  @Column({ name: 'performed_at', type: 'timestamptz' })
  performedAt: Date

  @Column({ name: 'last_decision_id', type: 'uuid', nullable: true })
  lastDecisionId: string | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
