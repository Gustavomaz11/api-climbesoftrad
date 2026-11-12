export interface PatientLinkSnapshot {
  targetUnitIds: string[]
  exams: Array<{
    id: string
    patientId: string
    encounterId: string
    patientIdentifierId: string | null
    patientLinkDecisionId: string | null
    patientIdentityStatus: string
  }>
  identifiers: Array<{ id: string; patientId: string; lastDecisionId: string | null }>
  encounters: Array<{ id: string; patientId: string; lastDecisionId: string | null }>
  reviews: Array<{
    id: string
    status: string
    version: number
    decisionId: string | null
    reason: string | null
  }>
}
import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'patient_link_decisions' })
export class PatientLinkDecisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId: string

  @Column({ name: 'source_patient_id', type: 'uuid' })
  sourcePatientId: string

  @Column({ name: 'target_patient_id', type: 'uuid' })
  targetPatientId: string

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: string

  @Column({ name: 'version', type: 'integer' })
  version: number

  @Column({ name: 'before', type: 'jsonb' })
  before: PatientLinkSnapshot

  @Column({ name: 'reason', type: 'varchar', length: 500 })
  reason: string

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
