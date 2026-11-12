export const workflowSchema = `
ALTER TABLE exams
  ADD COLUMN workflow_state varchar(20) NOT NULL DEFAULT 'TO_PREPARE' CHECK(workflow_state IN ('TO_PREPARE','READY','IN_PROGRESS','TYPED','SIGNED','PENDING','RECALLED','CANCELLED')),
  ADD COLUMN workflow_version integer NOT NULL DEFAULT 1,
  ADD COLUMN evidence_version integer NOT NULL DEFAULT 1,
  ADD COLUMN prepared_at timestamptz,
  ADD COLUMN prepared_by_user_id uuid REFERENCES auth_users(id),
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by_user_id uuid REFERENCES auth_users(id);
CREATE INDEX exams_work_queue ON exams(company_id,unit_id,workflow_state,archived_at);
CREATE TABLE preparation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,
  exam_type_id uuid,version integer NOT NULL,required_items jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,reason varchar(500) NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES auth_users(id),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,company_id),FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id),
  FOREIGN KEY(exam_type_id,company_id) REFERENCES exam_types(id,company_id)
);
CREATE UNIQUE INDEX preparation_policy_current ON preparation_policies(company_id,unit_id,COALESCE(exam_type_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE active;
CREATE TABLE preparation_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,exam_id uuid NOT NULL,
  policy_id uuid NOT NULL,evidence_version integer NOT NULL,item varchar(20) NOT NULL,
  confirmed boolean NOT NULL,exception_reason varchar(500),evidence_ids uuid[] NOT NULL,
  checked_by_user_id uuid NOT NULL REFERENCES auth_users(id),checked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id),
  FOREIGN KEY(policy_id,company_id) REFERENCES preparation_policies(id,company_id),
  UNIQUE(exam_id,policy_id,evidence_version,item)
);
CREATE TABLE exam_workflow_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,exam_id uuid NOT NULL,
  from_state varchar(20) NOT NULL,to_state varchar(20) NOT NULL,version integer NOT NULL,
  action varchar(40) NOT NULL,reason varchar(500) NOT NULL,
  actor_user_id uuid REFERENCES auth_users(id),origin varchar(10) NOT NULL DEFAULT 'USER',
  metadata jsonb NOT NULL DEFAULT '{}',occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id),UNIQUE(exam_id,version)
);
CREATE TABLE exam_workflow_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,unit_id uuid NOT NULL,exam_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK(kind IN ('PENDING','RECALL')),category varchar(40) NOT NULL,
  reason varchar(500) NOT NULL,requested_action varchar(20) CHECK(requested_action IN ('ACQUISITION','DOCUMENTS')),
  responsible_user_id uuid REFERENCES auth_users(id),opened_by_user_id uuid NOT NULL REFERENCES auth_users(id),
  phase varchar(20) NOT NULL CHECK(phase IN ('PREPARATION','REPORTING')),
  attachment_ids uuid[] NOT NULL DEFAULT '{}',comment_ids uuid[] NOT NULL DEFAULT '{}',opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,resolved_by_user_id uuid REFERENCES auth_users(id),resolution_reason varchar(500),
  resolution_study_ids uuid[] NOT NULL DEFAULT '{}',resolution_attachment_ids uuid[] NOT NULL DEFAULT '{}',
  complement_exam_id uuid,FOREIGN KEY(exam_id,company_id) REFERENCES exams(id,company_id),
  FOREIGN KEY(unit_id,company_id) REFERENCES hospital_units(id,company_id),
  FOREIGN KEY(complement_exam_id,company_id) REFERENCES exams(id,company_id)
);
CREATE INDEX workflow_issue_inbox ON exam_workflow_issues(company_id,unit_id,resolved_at,opened_at);
CREATE TABLE exam_issue_acknowledgements (
  issue_id uuid NOT NULL REFERENCES exam_workflow_issues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth_users(id),seen_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(issue_id,user_id)
);
`
