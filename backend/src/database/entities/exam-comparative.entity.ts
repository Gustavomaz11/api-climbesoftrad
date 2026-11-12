import { Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Entity } from 'typeorm'

@Entity({ name: 'exam_comparatives' })
export class ExamComparativeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'exam_id', type: 'uuid' })
  examId: string

  @Column({ name: 'comparative_exam_id', type: 'uuid' })
  comparativeExamId: string

  @Column({ name: 'linked_patient_id', type: 'uuid' })
  linkedPatientId: string

  @Column({ name: 'active', type: 'boolean' })
  active: boolean

  @Column({ name: 'version', type: 'integer' })
  version: number

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
