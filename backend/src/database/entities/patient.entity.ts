import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'patients' })
export class PatientEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'full_name', type: 'varchar', length: 120 })
  fullName: string

  @Column({ name: 'normalized_name', type: 'varchar', length: 120 })
  normalizedName: string

  @Column({ name: 'social_name', type: 'varchar', length: 120, nullable: true })
  socialName: string | null

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: string | null

  @Column({ name: 'sex', type: 'varchar', length: 10, nullable: true })
  sex: string | null

  @Column({ name: 'country', type: 'varchar', length: 80 })
  country: string

  @Column({ name: 'email', type: 'citext', nullable: true })
  email: string | null

  @Column({ name: 'revision', type: 'integer' })
  revision: number

  @Column({ name: 'merged_into_id', type: 'uuid', nullable: true })
  mergedIntoId: string | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
