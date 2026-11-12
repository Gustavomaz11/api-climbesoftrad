import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { PhysicianEntity } from './physician.entity'

@Entity({ name: 'medical_specialties' })
export class MedicalSpecialtyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'citext', unique: true })
  name: string

  @Column({ name: 'display_order', type: 'integer', unique: true })
  displayOrder: number

  @Column({ type: 'boolean', default: true })
  active: boolean

  @Column({ name: 'source_reference', type: 'varchar', length: 255 })
  sourceReference: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date

  @OneToMany(() => PhysicianEntity, (physician) => physician.specialty)
  physicians: PhysicianEntity[]
}
