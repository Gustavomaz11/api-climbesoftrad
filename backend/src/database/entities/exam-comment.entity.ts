import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { AuthUserEntity } from './auth-user.entity'
import { ExamCommentAttachmentEntity } from './exam-comment-attachment.entity'
import { ExamEntity } from './exam.entity'

@Entity({ name: 'exam_comments' })
@Index('idx_exam_comments_exam_created', ['examId', 'createdAt'])
export class ExamCommentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'exam_id', type: 'uuid' })
  examId: string

  @Column({ name: 'parent_comment_id', type: 'uuid', nullable: true })
  parentCommentId: string | null

  @Column({ name: 'author_user_id', type: 'uuid' })
  authorUserId: string

  @Column({ type: 'text' })
  body: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date

  @ManyToOne(() => ExamEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: ExamEntity

  @ManyToOne(() => AuthUserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_user_id' })
  author: AuthUserEntity

  @ManyToOne(() => ExamCommentEntity, (comment) => comment.replies, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_comment_id' })
  parent: ExamCommentEntity | null

  @OneToMany(() => ExamCommentEntity, (comment) => comment.parent)
  replies: ExamCommentEntity[]

  @OneToMany(() => ExamCommentAttachmentEntity, (attachment) => attachment.comment)
  attachments: ExamCommentAttachmentEntity[]
}
