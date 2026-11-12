import 'reflect-metadata'
import { HospitalReferralRouteEntity } from './entities/hospital-referral-route.entity'
import { HospitalIntakeEntity } from './entities/hospital-intake.entity'
import { UploadSessionEntity } from './entities/upload-session.entity'
import { DicomSourceEntity } from './entities/dicom-source.entity'
import { DicomStudyEntity } from './entities/dicom-study.entity'
import { DicomSeriesEntity } from './entities/dicom-series.entity'
import { DicomInstanceEntity } from './entities/dicom-instance.entity'
import { DicomReviewEntity } from './entities/dicom-review.entity'
import { DicomViewerGrantEntity } from './entities/dicom-viewer-grant.entity'
import { config } from 'dotenv'
import { DataSource } from 'typeorm'
import { AuthRefreshTokenEntity } from './entities/auth-refresh-token.entity'
import { AuthSecurityEventEntity } from './entities/auth-security-event.entity'
import { AuthSessionEntity } from './entities/auth-session.entity'
import { AuthUserEntity } from './entities/auth-user.entity'
import { ExamCommentAttachmentEntity } from './entities/exam-comment-attachment.entity'
import { ExamCommentEntity } from './entities/exam-comment.entity'
import { ExamReportPresenceEntity } from './entities/exam-report-presence.entity'
import { ExamEntity } from './entities/exam.entity'
import { OAuthAuthorizationCodeEntity } from './entities/oauth-authorization-code.entity'
import { OAuthClientEntity } from './entities/oauth-client.entity'
import { MedicalSpecialtyEntity } from './entities/medical-specialty.entity'
import { PhysicianEntity } from './entities/physician.entity'
import { HospitalUnitEntity } from './entities/hospital-unit.entity'
import { AccessPermissionEntity } from './entities/access-permission.entity'
import { AccessRoleEntity } from './entities/access-role.entity'
import { CompanyEntity } from './entities/company.entity'
import { CompanyMembershipEntity } from './entities/company-membership.entity'
import { CompanyMembershipUnitEntity } from './entities/company-membership-unit.entity'
import { CompanySettingsRevisionEntity } from './entities/company-settings-revision.entity'
import { OperationalEventEntity } from './entities/operational-event.entity'
import { PatientEntity } from './entities/patient.entity'
import { PatientUnitEntity } from './entities/patient-unit.entity'
import { PatientIdentifierEntity } from './entities/patient-identifier.entity'
import { PatientEncounterEntity } from './entities/patient-encounter.entity'
import { PatientRevisionEntity } from './entities/patient-revision.entity'
import { PatientReviewEntity } from './entities/patient-review.entity'
import { PatientLinkDecisionEntity } from './entities/patient-link-decision.entity'
import { ExamComparativeEntity } from './entities/exam-comparative.entity'
import { PatientImportBatchEntity } from './entities/patient-import-batch.entity'
import { PatientImportRowEntity } from './entities/patient-import-row.entity'
import { ExamTypeEntity } from './entities/exam-type.entity'
import { ExamTypeAliasEntity } from './entities/exam-type-alias.entity'
import { StoredObjectEntity } from './entities/stored-object.entity'
import { ExamAttachmentEntity } from './entities/exam-attachment.entity'
import { PhysicianQualificationEntity } from './entities/physician-qualification.entity'
import { ContrastProtocolEntity } from './entities/contrast-protocol.entity'
import { PrescriptionProtocolSelectionEntity } from './entities/prescription-protocol-selection.entity'
import { ExamPriceRuleEntity } from './entities/exam-price-rule.entity'

config({ path: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'] })

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
  logging: false,
  entities: [
    HospitalReferralRouteEntity,
    HospitalIntakeEntity,
    UploadSessionEntity, DicomSourceEntity, DicomStudyEntity, DicomSeriesEntity,
    DicomInstanceEntity, DicomReviewEntity, DicomViewerGrantEntity,
    StoredObjectEntity,
    ExamAttachmentEntity,
    PhysicianQualificationEntity,
    ContrastProtocolEntity,
    PrescriptionProtocolSelectionEntity,
    ExamPriceRuleEntity,
    PatientEntity,
    PatientUnitEntity,
    PatientIdentifierEntity,
    PatientEncounterEntity,
    PatientRevisionEntity,
    PatientReviewEntity,
    PatientLinkDecisionEntity,
    ExamComparativeEntity,
    PatientImportBatchEntity,
    PatientImportRowEntity,
    ExamTypeEntity,
    ExamTypeAliasEntity,
    CompanyEntity,
    CompanyMembershipEntity,
    CompanyMembershipUnitEntity,
    CompanySettingsRevisionEntity,
    OperationalEventEntity,
    AuthUserEntity,
    OAuthClientEntity,
    OAuthAuthorizationCodeEntity,
    AuthSessionEntity,
    AuthRefreshTokenEntity,
    AuthSecurityEventEntity,
    ExamEntity,
    ExamReportPresenceEntity,
    ExamCommentEntity,
    ExamCommentAttachmentEntity,
    MedicalSpecialtyEntity,
    PhysicianEntity,
    HospitalUnitEntity,
    AccessPermissionEntity,
    AccessRoleEntity,
  ],
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
})
