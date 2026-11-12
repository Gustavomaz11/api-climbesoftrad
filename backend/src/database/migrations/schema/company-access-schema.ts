export const companyAccessSchema = `
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name CITEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE hospital_units ADD COLUMN company_id UUID;
ALTER TABLE access_roles ADD COLUMN company_id UUID;
ALTER TABLE exams ADD COLUMN company_id UUID;

CREATE TABLE company_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
  access_role_id UUID NOT NULL REFERENCES access_roles(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  all_units BOOLEAN NOT NULL DEFAULT FALSE,
  signature_text VARCHAR(500),
  preferences_version INTEGER NOT NULL DEFAULT 0 CHECK(preferences_version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, user_id),
  UNIQUE(id, company_id)
);
CREATE TABLE company_membership_units (
  membership_id UUID NOT NULL,
  unit_id UUID NOT NULL,
  company_id UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(membership_id, unit_id)
);
CREATE TABLE company_settings_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  unit_id UUID,
  version INTEGER NOT NULL CHECK (version > 0),
  presentation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX company_settings_company_version
  ON company_settings_revisions(company_id, version) WHERE unit_id IS NULL;
CREATE UNIQUE INDEX company_settings_unit_version
  ON company_settings_revisions(company_id, unit_id, version) WHERE unit_id IS NOT NULL;
CREATE TABLE operational_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  unit_id UUID,
  actor_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
  correlation_id UUID NOT NULL,
  action VARCHAR(60) NOT NULL,
  resource_type VARCHAR(40) NOT NULL,
  resource_id UUID,
  outcome VARCHAR(20) NOT NULL DEFAULT 'SUCCEEDED'
    CHECK(outcome IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  reason VARCHAR(500),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX operational_events_company_time ON operational_events(company_id, occurred_at DESC);
CREATE INDEX operational_events_resource ON operational_events(company_id, resource_id);
`

export const companyAccessConstraints = `
ALTER TABLE hospital_units ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE access_roles ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE exams ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE hospital_units ADD CONSTRAINT hospital_units_company_fk
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE access_roles ADD CONSTRAINT access_roles_company_fk
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE hospital_units ADD CONSTRAINT hospital_units_company_name UNIQUE(company_id, name);
ALTER TABLE hospital_units ADD CONSTRAINT hospital_units_id_company UNIQUE(id, company_id);
ALTER TABLE access_roles ADD CONSTRAINT access_roles_company_code UNIQUE(company_id, code);
ALTER TABLE access_roles ADD CONSTRAINT access_roles_company_name UNIQUE(company_id, name);
ALTER TABLE access_roles ADD CONSTRAINT access_roles_id_company UNIQUE(id, company_id);
ALTER TABLE exams ADD CONSTRAINT exams_unit_company_fk
  FOREIGN KEY(unit_id, company_id) REFERENCES hospital_units(id, company_id) ON DELETE RESTRICT;
ALTER TABLE company_memberships ADD CONSTRAINT membership_role_company_fk
  FOREIGN KEY(access_role_id, company_id) REFERENCES access_roles(id, company_id) ON DELETE RESTRICT;
ALTER TABLE company_membership_units ADD CONSTRAINT membership_unit_company_fk
  FOREIGN KEY(unit_id, company_id) REFERENCES hospital_units(id, company_id) ON DELETE RESTRICT;
ALTER TABLE company_membership_units ADD CONSTRAINT membership_unit_membership_company_fk
  FOREIGN KEY(membership_id, company_id) REFERENCES company_memberships(id, company_id) ON DELETE CASCADE;
ALTER TABLE company_settings_revisions ADD CONSTRAINT settings_unit_company_fk
  FOREIGN KEY(unit_id, company_id) REFERENCES hospital_units(id, company_id) ON DELETE RESTRICT;
ALTER TABLE operational_events ADD CONSTRAINT operational_events_unit_company_fk
  FOREIGN KEY(unit_id, company_id) REFERENCES hospital_units(id, company_id) ON DELETE RESTRICT;
CREATE INDEX exams_company_performed ON exams(company_id, performed_at DESC);
CREATE INDEX company_memberships_user ON company_memberships(user_id, active);
CREATE INDEX company_membership_units_unit ON company_membership_units(company_id, unit_id, active);
`
