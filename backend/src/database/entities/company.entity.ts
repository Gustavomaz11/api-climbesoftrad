import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

@Entity({ name: 'companies' })
export class CompanyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'citext', unique: true })
  name: string

  @Column({ type: 'boolean', default: true })
  active: boolean

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
