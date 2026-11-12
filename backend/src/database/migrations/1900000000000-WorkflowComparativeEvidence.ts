import type { MigrationInterface, QueryRunner } from 'typeorm'

export class WorkflowComparativeEvidence1900000000000 implements MigrationInterface {
  name = 'WorkflowComparativeEvidence1900000000000'
  async up(runner: QueryRunner) {
    await runner.query(`CREATE OR REPLACE FUNCTION workflow_evidence_changed() RETURNS trigger AS $$
      DECLARE target uuid; actor uuid; related uuid;
      BEGIN
        IF TG_TABLE_NAME='dicom_instances' THEN
          SELECT exam_id INTO target FROM dicom_studies WHERE id=NEW.study_id;
          SELECT created_by_user_id INTO actor FROM stored_objects WHERE id=NEW.object_id;
        ELSE target := NEW.exam_id; actor := NEW.created_by_user_id;
        END IF;
        PERFORM invalidate_exam_preparation(target,TG_TABLE_NAME || ':' || NEW.id::text,actor);
        FOR related IN SELECT exam_id FROM exam_comparatives WHERE comparative_exam_id=target AND active ORDER BY exam_id LOOP
          PERFORM invalidate_exam_preparation(related,'Evidência do comparativo alterada: ' || target::text,actor);
        END LOOP;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;`)
  }
  down(): Promise<void> {
    return Promise.reject(new Error(
      'Preserve a invalidação de comparativos usados. Reverta a frente somente com plano de conservação do histórico.',
    ))
  }
}
