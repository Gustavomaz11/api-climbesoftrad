// These triggers also cover ingestion and reconciliation paths outside the workflow controller.
export const workflowEvidenceTriggers = `
CREATE FUNCTION invalidate_exam_preparation(target uuid, explanation text, actor uuid) RETURNS void AS $$
DECLARE e exams%ROWTYPE; next_state text;
BEGIN
  SELECT * INTO e FROM exams WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  next_state := CASE WHEN e.workflow_state IN ('READY','IN_PROGRESS','TYPED') THEN 'TO_PREPARE' ELSE e.workflow_state END;
  UPDATE exams SET evidence_version=evidence_version+1,workflow_version=workflow_version+1,
    prepared_at=NULL,prepared_by_user_id=NULL,workflow_state=next_state WHERE id=target;
  INSERT INTO exam_workflow_history(company_id,exam_id,from_state,to_state,version,action,reason,actor_user_id,origin)
    VALUES(e.company_id,e.id,e.workflow_state,next_state,e.workflow_version+1,'EVIDENCE_CHANGED',explanation,actor,'SYSTEM');
END; $$ LANGUAGE plpgsql;
CREATE FUNCTION workflow_evidence_changed() RETURNS trigger AS $$
DECLARE target uuid; actor uuid;
BEGIN
  IF TG_TABLE_NAME='dicom_instances' THEN
    SELECT exam_id INTO target FROM dicom_studies WHERE id=NEW.study_id;
    SELECT created_by_user_id INTO actor FROM stored_objects WHERE id=NEW.object_id;
  ELSE
    target := NEW.exam_id;
    actor := NEW.created_by_user_id;
  END IF;
  PERFORM invalidate_exam_preparation(target,TG_TABLE_NAME || ':' || NEW.id::text,actor);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER workflow_attachment AFTER INSERT OR UPDATE OF superseded_at,validation_status ON exam_attachments
  FOR EACH ROW EXECUTE FUNCTION workflow_evidence_changed();
CREATE TRIGGER workflow_dicom AFTER INSERT ON dicom_instances FOR EACH ROW EXECUTE FUNCTION workflow_evidence_changed();
CREATE TRIGGER workflow_comparative AFTER INSERT OR UPDATE OF active,linked_patient_id ON exam_comparatives
  FOR EACH ROW EXECUTE FUNCTION workflow_evidence_changed();
CREATE FUNCTION workflow_exam_fields_changed() RETURNS trigger AS $$
DECLARE related uuid;
BEGIN
  IF ROW(OLD.patient_id,OLD.patient_identity_status,OLD.exam_type_id,OLD.normalization_status,
    OLD.priority,OLD.requester_name,OLD.requester_reference,OLD.performing_physician,OLD.health_insurance,
    OLD.study_description,OLD.modality,OLD.performed_at)
    IS DISTINCT FROM ROW(NEW.patient_id,NEW.patient_identity_status,NEW.exam_type_id,NEW.normalization_status,
    NEW.priority,NEW.requester_name,NEW.requester_reference,NEW.performing_physician,NEW.health_insurance,
    NEW.study_description,NEW.modality,NEW.performed_at) THEN
    PERFORM invalidate_exam_preparation(NEW.id,'Dados relevantes do exame alterados',NULL);
    FOR related IN SELECT exam_id FROM exam_comparatives WHERE comparative_exam_id=NEW.id AND active LOOP
      PERFORM invalidate_exam_preparation(related,'Dados do exame comparativo alterados',NULL);
    END LOOP;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER workflow_exam_fields AFTER UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION workflow_exam_fields_changed();
`
