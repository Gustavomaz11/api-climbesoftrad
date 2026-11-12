import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'exam_types' })
export class ExamTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'name', type: 'varchar', length: 180 })
  name: string

  @Column({ name: 'modality', type: 'varchar', length: 16 })
  modality: string

  @Column({ name: 'group_name', type: 'varchar', length: 120 })
  groupName: string

  @Column({ name: 'active', type: 'boolean' })
  active: boolean

  @Column({ name: 'version', type: 'integer' })
  version: number

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
