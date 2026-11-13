import type {MigrationInterface,QueryRunner} from 'typeorm'

export class ReportVersionLineage2070000000000 implements MigrationInterface {
  async up(q:QueryRunner):Promise<void> {
    await q.query(`
      CREATE FUNCTION validate_report_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE previous exam_report_completions%ROWTYPE;
      BEGIN
        IF NEW.version>1 THEN
          SELECT * INTO previous FROM exam_report_completions WHERE id=NEW.previous_version_id;
          IF NOT FOUND OR previous.exam_id<>NEW.exam_id OR previous.version<>NEW.version-1 THEN
            RAISE EXCEPTION 'Invalid signed report version lineage';
          END IF;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER report_lineage BEFORE INSERT ON exam_report_completions FOR EACH ROW EXECUTE FUNCTION validate_report_lineage();
      INSERT INTO access_roles(company_id,code,name,description,immutable,active)
        SELECT id,'SENIOR_DOCTOR','Médico sênior','Atividades médicas e reassinatura justificada de laudos de outros médicos.',false,true FROM companies
        ON CONFLICT(company_id,code) DO NOTHING;
      INSERT INTO access_role_permissions(role_id,permission_code)
        SELECT senior.id,p.permission_code FROM access_roles senior JOIN access_roles doctor ON doctor.company_id=senior.company_id AND doctor.code='DOCTOR'
        JOIN access_role_permissions p ON p.role_id=doctor.id WHERE senior.code='SENIOR_DOCTOR' ON CONFLICT DO NOTHING;
      INSERT INTO access_role_permissions(role_id,permission_code) SELECT id,'reports.resign.other' FROM access_roles WHERE code='SENIOR_DOCTOR' ON CONFLICT DO NOTHING;
    `)
  }
  async down(q:QueryRunner):Promise<void> {
    await q.query('DROP TRIGGER report_lineage ON exam_report_completions; DROP FUNCTION validate_report_lineage()')
  }
}
