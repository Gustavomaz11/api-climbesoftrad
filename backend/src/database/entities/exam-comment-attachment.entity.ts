import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { ExamCommentEntity } from './exam-comment.entity'

@Entity({ name: 'exam_comment_attachments' })
export class ExamCommentAttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'comment_id', type: 'uuid' })
  commentId: string

  @Column({ name: 'storage_key', type: 'varchar', length: 500, unique: true })
  storageKey: string

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string

  @Column({ name: 'content_type', type: 'varchar', length: 120 })
  contentType: string

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @ManyToOne(() => ExamCommentEntity, (comment) => comment.attachments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'comment_id' })
  comment: ExamCommentEntity
}
