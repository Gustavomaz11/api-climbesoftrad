import type { MigrationInterface, QueryRunner } from 'typeorm'
export class ResearchReanalysisLineage1970000000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(
      'ALTER TABLE research_ai_cases ADD COLUMN source_case_id uuid REFERENCES research_ai_cases(id); CREATE INDEX research_ai_source_case ON research_ai_cases(source_case_id);',
    )
  }
  async down(runner: QueryRunner) {
    const [used] = (await runner.query(
      'SELECT count(*)::int AS count FROM research_ai_cases WHERE source_case_id IS NOT NULL',
    )) as Array<{ count: number }>
    if (used?.count) throw new Error('Preserve research lineage before reverting')
    await runner.query(
      'DROP INDEX research_ai_source_case; ALTER TABLE research_ai_cases DROP COLUMN source_case_id;',
    )
  }
}
