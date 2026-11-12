import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { StoredObjectEntity } from './stored-object.entity'
import { AuthUserEntity } from './auth-user.entity'

export const examAttachmentCategories = ['ORDER', 'QUESTIONNAIRE', 'COMPARATIVE'] as const
export type ExamAttachmentCategory = (typeof examAttachmentCategories)[number]

@Entity({ name: 'exam_attachments' })
export class ExamAttachmentEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'exam_id', type: 'uuid' }) examId: string
  @Column({ name: 'object_id', type: 'uuid' }) objectId: string
  @Column({ type: 'varchar', length: 20 }) category: ExamAttachmentCategory
  @Column({ type: 'integer', default: 1 }) version: number
  @Column({ name: 'replaces_id', type: 'uuid', nullable: true }) replacesId: string | null
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true }) supersededAt: Date | null
  @Column({ name: 'validation_status', type: 'varchar', length: 30 })
  validationStatus: 'SIGNATURE_VALIDATED' | 'APPROVED' | 'QUARANTINED' | 'REJECTED'
  @Column({ type: 'varchar', length: 500, nullable: true }) reason: string | null
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId: string
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
  @ManyToOne(() => StoredObjectEntity) @JoinColumn({ name: 'object_id' }) object: StoredObjectEntity
  @ManyToOne(() => AuthUserEntity)
  @JoinColumn({ name: 'created_by_user_id' })
  author: AuthUserEntity
}
