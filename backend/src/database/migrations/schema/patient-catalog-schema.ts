export const patientCatalogSchema = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE patients (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
 full_name VARCHAR(120) NOT NULL, normalized_name VARCHAR(120) NOT NULL, social_name VARCHAR(120),
 birth_date DATE, sex VARCHAR(10) CHECK(sex IS NULL OR sex IN ('MASCULINO','FEMININO')), country VARCHAR(80) NOT NULL DEFAULT 'Brasil', email CITEXT,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), merged_into_id UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(id,company_id), CHECK(merged_into_id IS NULL OR merged_into_id<>id),
 FOREIGN KEY(merged_into_id,company_id) REFERENCES patients(id,company_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX patients_company_name ON patients(company_id,normalized_name);
CREATE INDEX patients_name_search ON patients USING gin(normalized_name gin_trgm_ops);
CREATE INDEX patients_company_birth ON patients(company_id,birth_date);
CREATE TABLE patient_units (patient_id UUID NOT NULL, unit_id UUID NOT NULL,company_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(patient_id,unit_id),UNIQUE(patient_id,unit_id,company_id),FOREIGN KEY(patient_id,company_id) REFERENCES patients(id,company_id),FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id));
CREATE INDEX patient_units_scope ON patient_units(company_id,unit_id,patient_id);
CREATE TABLE patient_identifiers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL,unit_id UUID NOT NULL,patient_id UUID NOT NULL,
 issuer VARCHAR(120) NOT NULL,original_value VARCHAR(120) NOT NULL,source VARCHAR(20) NOT NULL CHECK(source IN ('EXAM','MANUAL','IMPORT')), reliable BOOLEAN NOT NULL DEFAULT TRUE,version INTEGER NOT NULL DEFAULT 0, last_decision_id UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(company_id,unit_id,issuer,original_value),UNIQUE(id,company_id),UNIQUE(id,patient_id,unit_id,company_id),
 FOREIGN KEY(patient_id,unit_id,company_id) REFERENCES patient_units(patient_id,unit_id,company_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX patient_identifiers_patient ON patient_identifiers(company_id,patient_id);
CREATE TABLE patient_encounters (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL,unit_id UUID NOT NULL,patient_id UUID NOT NULL,issuer VARCHAR(120),external_id VARCHAR(120),performed_at TIMESTAMPTZ NOT NULL,last_decision_id UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(id,patient_id,unit_id,company_id),FOREIGN KEY(patient_id,unit_id,company_id) REFERENCES patient_units(patient_id,unit_id,company_id) DEFERRABLE INITIALLY DEFERRED,CHECK(external_id IS NULL OR issuer IS NOT NULL)
);
CREATE UNIQUE INDEX encounter_origin ON patient_encounters(company_id,unit_id,issuer,external_id) WHERE external_id IS NOT NULL;
CREATE TABLE patient_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL,patient_id UUID NOT NULL,version INTEGER NOT NULL CHECK(version>=0),demographics JSONB NOT NULL,reason VARCHAR(500) NOT NULL,actor_user_id UUID NOT NULL REFERENCES auth_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(patient_id,version),FOREIGN KEY(patient_id,company_id) REFERENCES patients(id,company_id)
);
CREATE TABLE patient_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL,unit_id UUID NOT NULL,patient_id UUID NOT NULL,exam_id UUID REFERENCES exams(id),kind VARCHAR(30) NOT NULL CHECK(kind IN ('LEGACY','UNIDENTIFIED','SUGGESTION','CONFLICT')),status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','APPROVED','REJECTED','REVERTED')),version INTEGER NOT NULL DEFAULT 0,candidates JSONB NOT NULL DEFAULT '[]',differences JSONB NOT NULL DEFAULT '[]',reason VARCHAR(500),decision_id UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(id,company_id),FOREIGN KEY(patient_id,unit_id,company_id) REFERENCES patient_units(patient_id,unit_id,company_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX patient_review_open ON patient_reviews(patient_id,unit_id,kind) WHERE status='OPEN';
CREATE INDEX patient_review_queue ON patient_reviews(company_id,status,created_at);
CREATE TABLE patient_link_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL,review_id UUID NOT NULL,source_patient_id UUID NOT NULL,target_patient_id UUID NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'APPLIED' CHECK(status IN ('APPLIED','REVERTED')),version INTEGER NOT NULL DEFAULT 0,
 before JSONB NOT NULL,reason VARCHAR(500) NOT NULL,actor_user_id UUID NOT NULL REFERENCES auth_users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(id,company_id),FOREIGN KEY(review_id,company_id) REFERENCES patient_reviews(id,company_id),FOREIGN KEY(source_patient_id,company_id) REFERENCES patients(id,company_id),FOREIGN KEY(target_patient_id,company_id) REFERENCES patients(id,company_id),CHECK(source_patient_id<>target_patient_id)
);
ALTER TABLE patient_reviews ADD FOREIGN KEY(decision_id,company_id) REFERENCES patient_link_decisions(id,company_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE patient_identifiers ADD FOREIGN KEY(last_decision_id,company_id) REFERENCES patient_link_decisions(id,company_id);
ALTER TABLE patient_encounters ADD FOREIGN KEY(last_decision_id,company_id) REFERENCES patient_link_decisions(id,company_id);
CREATE TABLE exam_types (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL REFERENCES companies(id),name VARCHAR(180) NOT NULL,modality VARCHAR(10) NOT NULL,group_name VARCHAR(120) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,version INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(id,company_id),UNIQUE(company_id,modality,name),CHECK(modality IN ('MR','CT','CR','DX','US','MG','OT','XA','CP','NM','ES','EEG','ECG','BMD'))
);
CREATE TABLE exam_type_aliases (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL,exam_type_id UUID NOT NULL,unit_id UUID,issuer VARCHAR(120),description VARCHAR(180) NOT NULL,normalized_description VARCHAR(180) NOT NULL,modality VARCHAR(10) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(id,company_id),FOREIGN KEY(exam_type_id,company_id) REFERENCES exam_types(id,company_id),FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id)
);
CREATE UNIQUE INDEX exam_alias_identity ON exam_type_aliases(company_id,exam_type_id,COALESCE(unit_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(issuer,''),normalized_description,modality);
CREATE INDEX exam_alias_resolution ON exam_type_aliases(company_id,normalized_description,modality);
ALTER TABLE exams ADD COLUMN patient_id UUID,ADD COLUMN encounter_id UUID,ADD COLUMN patient_identifier_id UUID,ADD COLUMN patient_link_decision_id UUID,ADD COLUMN patient_identity_status VARCHAR(20) NOT NULL DEFAULT 'LEGACY',ADD COLUMN received_patient_data JSONB NOT NULL DEFAULT '{}',ADD COLUMN origin_issuer VARCHAR(120),ADD COLUMN external_patient_id VARCHAR(120),ADD COLUMN source_exam_id VARCHAR(120),ADD COLUMN source_payload_hash VARCHAR(64),ADD COLUMN exam_type_id UUID,ADD COLUMN normalization_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',ADD COLUMN normalization_alias_id UUID,ADD COLUMN normalization_rule_version INTEGER;
ALTER TABLE exams ADD CONSTRAINT exams_id_company UNIQUE(id,company_id);
ALTER TABLE patient_reviews ADD CONSTRAINT patient_review_exam_company FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE exams ADD CONSTRAINT exams_identity_status CHECK(patient_identity_status IN ('LEGACY','IDENTIFIED','UNIDENTIFIED','SUGGESTION','CONFLICT'));
ALTER TABLE exams ADD CONSTRAINT exams_normalization_status CHECK(normalization_status IN ('APPROVED','UNKNOWN','AMBIGUOUS','INACTIVE'));
ALTER TABLE exams ADD CONSTRAINT exams_type_required CHECK(normalization_status<>'APPROVED' OR exam_type_id IS NOT NULL);
ALTER TABLE exams ADD CONSTRAINT exams_patient_company FOREIGN KEY(patient_id,company_id) REFERENCES patients(id,company_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE exams ADD CONSTRAINT exams_encounter_patient FOREIGN KEY(encounter_id,patient_id,unit_id,company_id) REFERENCES patient_encounters(id,patient_id,unit_id,company_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE exams ADD CONSTRAINT exams_identifier_patient FOREIGN KEY(patient_identifier_id,patient_id,unit_id,company_id) REFERENCES patient_identifiers(id,patient_id,unit_id,company_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE exams ADD CONSTRAINT exams_link_decision FOREIGN KEY(patient_link_decision_id,company_id) REFERENCES patient_link_decisions(id,company_id);
ALTER TABLE exams ADD CONSTRAINT exams_type_company FOREIGN KEY(exam_type_id,company_id) REFERENCES exam_types(id,company_id);
ALTER TABLE exams ADD CONSTRAINT exams_alias_company FOREIGN KEY(normalization_alias_id,company_id) REFERENCES exam_type_aliases(id,company_id);
CREATE UNIQUE INDEX exam_source_identity ON exams(company_id,unit_id,origin_issuer,source_exam_id) WHERE source_exam_id IS NOT NULL;
CREATE INDEX exams_patient_history ON exams(company_id,patient_id,performed_at DESC);
CREATE TABLE exam_comparatives (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL,exam_id UUID NOT NULL,comparative_exam_id UUID NOT NULL,linked_patient_id UUID NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,version INTEGER NOT NULL DEFAULT 0,created_by_user_id UUID NOT NULL REFERENCES auth_users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(exam_id,comparative_exam_id),CHECK(exam_id<>comparative_exam_id),FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id),FOREIGN KEY(comparative_exam_id,company_id) REFERENCES exams(id,company_id),FOREIGN KEY(linked_patient_id,company_id) REFERENCES patients(id,company_id)
);
CREATE TABLE patient_import_batches (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL REFERENCES companies(id),name VARCHAR(120) NOT NULL,content_hash VARCHAR(64) NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'PREVIEW',unit_ids JSONB NOT NULL DEFAULT '[]',created_by_user_id UUID NOT NULL REFERENCES auth_users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(id,company_id),UNIQUE(company_id,content_hash)
);
CREATE TABLE patient_import_rows (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL,batch_id UUID NOT NULL,line INTEGER NOT NULL,data JSONB NOT NULL,status VARCHAR(20) NOT NULL CHECK(status IN ('READY','ALREADY_LINKED','CONFLICT','INVALID','REJECTED','APPLIED')),included BOOLEAN NOT NULL DEFAULT FALSE,message VARCHAR(500),version INTEGER NOT NULL DEFAULT 0,result JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(batch_id,line),FOREIGN KEY(batch_id,company_id) REFERENCES patient_import_batches(id,company_id)
);
`
