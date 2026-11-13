import type {MigrationInterface,QueryRunner} from 'typeorm'

export class PreserveTypedReport2080000000000 implements MigrationInterface {
  async up(q:QueryRunner):Promise<void> {
    await q.query(`CREATE OR REPLACE FUNCTION invalidate_exam_preparation(target uuid, explanation text, actor uuid) RETURNS void AS $$
      DECLARE e exams%ROWTYPE; next_state text;
      BEGIN
        SELECT * INTO e FROM exams WHERE id=target FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        next_state := CASE WHEN e.workflow_state IN ('READY','IN_PROGRESS') THEN 'TO_PREPARE' ELSE e.workflow_state END;
        UPDATE exams SET evidence_version=evidence_version+1,workflow_version=workflow_version+1,
          prepared_at=NULL,prepared_by_user_id=NULL,workflow_state=next_state WHERE id=target;
        INSERT INTO exam_workflow_history(company_id,exam_id,from_state,to_state,version,action,reason,actor_user_id,origin)
          VALUES(e.company_id,e.id,e.workflow_state,next_state,e.workflow_version+1,'EVIDENCE_CHANGED',explanation,actor,'SYSTEM');
      END; $$ LANGUAGE plpgsql;`)
  }
  down():Promise<void> {
    return Promise.reject(new Error('Preserve the saved report state with a forward migration.'))
  }
}
