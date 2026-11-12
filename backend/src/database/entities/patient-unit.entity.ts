import { Column, CreateDateColumn, UpdateDateColumn, PrimaryColumn, Entity } from 'typeorm'

@Entity({ name: 'patient_units' })
export class PatientUnitEntity {
  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @PrimaryColumn({ name: 'patient_id', type: 'uuid' })
  patientId: string

  @PrimaryColumn({ name: 'unit_id', type: 'uuid' })
  unitId: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
