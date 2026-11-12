import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'exam_type_aliases' })
export class ExamTypeAliasEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'exam_type_id', type: 'uuid' })
  examTypeId: string

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null

  @Column({ name: 'issuer', type: 'varchar', length: 120, nullable: true })
  issuer: string | null

  @Column({ name: 'description', type: 'varchar', length: 180 })
  description: string

  @Column({ name: 'normalized_description', type: 'varchar', length: 180 })
  normalizedDescription: string

  @Column({ name: 'modality', type: 'varchar', length: 16 })
  modality: string

  @Column({ name: 'active', type: 'boolean' })
  active: boolean

  @Column({ name: 'version', type: 'integer' })
  version: number

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
