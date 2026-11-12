import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'patient_revisions' })
export class PatientRevisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string

  @Column({ name: 'version', type: 'integer' })
  version: number

  @Column({ name: 'demographics', type: 'jsonb' })
  demographics: Record<string, unknown> | unknown[]

  @Column({ name: 'reason', type: 'varchar', length: 500 })
  reason: string

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
