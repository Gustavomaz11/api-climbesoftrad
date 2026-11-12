import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm'
import { AuthUserEntity } from './auth-user.entity'
import { ExamEntity } from './exam.entity'

@Entity({ name: 'exam_report_presences' })
@Index('idx_exam_report_presences_active', ['examId', 'lastSeenAt'])
export class ExamReportPresenceEntity {
  @PrimaryColumn({ name: 'exam_id', type: 'uuid' })
  examId: string

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string

  @PrimaryColumn({ name: 'client_id', type: 'uuid' })
  clientId: string

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date

  @ManyToOne(() => ExamEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: ExamEntity

  @ManyToOne(() => AuthUserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AuthUserEntity
}
