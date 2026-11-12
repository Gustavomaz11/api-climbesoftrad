import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ExamComments1750000000000 implements MigrationInterface {
  name = 'ExamComments1750000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE exam_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        parent_comment_id UUID REFERENCES exam_comments(id) ON DELETE CASCADE,
        author_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_exam_comments_exam_created ON exam_comments(exam_id, created_at);

      CREATE TABLE exam_comment_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        comment_id UUID NOT NULL REFERENCES exam_comments(id) ON DELETE CASCADE,
        storage_key VARCHAR(500) NOT NULL UNIQUE,
        original_name VARCHAR(255) NOT NULL,
        content_type VARCHAR(120) NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_exam_comment_attachments_comment
        ON exam_comment_attachments(comment_id);
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS exam_comment_attachments;')
    await queryRunner.query('DROP TABLE IF EXISTS exam_comments;')
  }
}
