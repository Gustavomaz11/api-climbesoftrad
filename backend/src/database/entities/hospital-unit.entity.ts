import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { ExamEntity } from './exam.entity'

@Entity({ name: 'hospital_units' })
export class HospitalUnitEntity {
  @Column({ type: 'varchar', length: 14, nullable: true }) cnpj: string | null
  @Column({ name: 'legal_name', type: 'varchar', length: 160, nullable: true }) legalName: string | null
  @Column({ name: 'trade_name', type: 'varchar', length: 160, nullable: true }) tradeName: string | null
  @Column({ name: 'internal_identifier', type: 'varchar', length: 120, nullable: true }) internalIdentifier: string | null
  @Column({ type: 'jsonb', nullable: true }) address: { zipCode: string; street: string; number: string; neighborhood: string; city: string } | null
  @Column({ name: 'contact_phone', type: 'varchar', length: 30, nullable: true }) contactPhone: string | null
  @Column({ name: 'contact_email', type: 'varchar', length: 254, nullable: true }) contactEmail: string | null

  @Column({ type: 'varchar', length: 2, nullable: true })
  uf: string | null
  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'citext' })
  name: string

  @Column({ type: 'boolean', default: true })
  active: boolean

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date

  @OneToMany(() => ExamEntity, (exam) => exam.unit)
  exams: ExamEntity[]
}
