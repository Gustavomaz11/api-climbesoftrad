import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

export const operationalActions = [
  'REPORT_FORCE_RELEASE_REQUESTED', 'REPORT_SESSION_EXPIRED', 'REPORT_REVIEW_REQUESTED',
  'REPORT_REASSIGN_AUTHORIZED', 'REPORT_REVISION_STARTED', 'REPORT_RESIGNED', 'REPORT_REVALIDATED',
  'REPORT_VERSION_ACCESSED', 'REPORT_PRINT_REQUESTED', 'REPORT_EXPORT_REQUESTED',
  'ROUTER_INSTALLER_CREATED',
  'PHYSICIAN_SIGNATURE_SAVED',
  'REPORT_FINALIZED', 'REPORT_DELIVERED', 'HOSPITAL_RESULT_ACCESSED',
  'EXAM_MODALITY_SAVED',
  'HOSPITAL_DICOM_VIEWER_OPENED',
  'HOSPITAL_REFERRAL_ROUTE_CONFIGURED', 'HOSPITAL_REFERRAL_RECEIVED', 'HOSPITAL_INTAKE_REASSIGNED',
  'HOSPITAL_STUDY_SUBMITTED',
  'PREPARATION_POLICY_CHANGED', 'PREPARATION_CHECKED', 'EXAM_WORKFLOW_CHANGED',
  'EXAM_FIELDS_CHANGED', 'EXAM_PRIORITY_CHANGED', 'EXAM_ISSUE_OPENED', 'EXAM_ISSUE_RESOLVED',
  'EXAM_ISSUE_ACKNOWLEDGED', 'EXAM_RECALLED', 'EXAM_ARCHIVED', 'EXAM_UNARCHIVED',
  'UPLOAD_STARTED', 'UPLOAD_COMPLETED', 'UPLOAD_CANCELLED', 'UPLOAD_VALIDATED',
  'DICOM_SOURCE_CREATED', 'DICOM_SOURCE_REVOKED', 'DICOM_INSTANCE_RECEIVED',
  'DICOM_STUDY_COMPLETED', 'DICOM_REVIEW_DECIDED', 'DICOM_VIEWER_OPENED',
  'DICOM_DOWNLOAD_REQUESTED', 'DICOM_DOWNLOAD_DELIVERED',
  'CONTRAST_PROTOCOL_CREATED',
  'CONTRAST_PROTOCOL_ACTIVATED',
  'CONTRAST_PROTOCOL_RETIRED',
  'PRESCRIPTION_PROTOCOL_SELECTED',
  'EXAM_PRICE_CREATED',
  'EXAM_PRICE_CLOSED',
  'EXAM_ATTACHMENT_UPLOADED',
  'EXAM_ATTACHMENT_CREATED',
  'EXAM_ATTACHMENT_REPLACED',
  'EXAM_ATTACHMENT_ACCESSED',
  'PHYSICIAN_QUALIFICATION_CHANGED',
  'PATIENT_CREATED',
  'PATIENT_CORRECTED',
  'PATIENT_IDENTIFIER_ADDED',
  'PATIENT_REVIEW_CREATED',
  'PATIENT_MATCH_APPROVED',
  'PATIENT_MATCH_REJECTED',
  'PATIENT_MATCH_REVERTED',
  'PATIENT_IMPORT_PREVIEWED',
  'PATIENT_IMPORT_REVIEWED',
  'PATIENT_IMPORT_ROW_APPLIED',
  'PATIENT_IMPORT_ROW_REVERTED',
  'EXAM_TYPE_CREATED',
  'EXAM_TYPE_UPDATED',
  'EXAM_TYPE_ALIAS_UPDATED',
  'EXAM_CLASSIFICATION_REVIEWED',
  'EXAM_COMPARATIVE_LINKED',
  'EXAM_COMPARATIVE_REMOVED',
  'COMPANY_CREATED',
  'COMPANY_UPDATED',
  'UNIT_CREATED',
  'UNIT_UPDATED',
  'UNIT_STATUS_CHANGED',
  'MEMBERSHIP_CREATED',
  'MEMBERSHIP_UPDATED',
  'MEMBERSHIP_REVOKED',
  'MEMBERSHIP_REACTIVATED',
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_STATUS_CHANGED',
  'ROLE_ASSIGNED',
  'COMPANY_SETTINGS_CHANGED',
  'MEMBERSHIP_PREFERENCES_CHANGED',
  'EXAM_CREATED',
  'COMMENT_CREATED',
  'COMMENT_ATTACHMENT_UPLOADED',
  'COMMENT_ATTACHMENT_REMOVED',
  'REPORT_SAVED',
  'REPORT_IMAGE_UPLOADED',
  'REPORT_PRESENCE_STARTED',
  'REPORT_PRESENCE_ENDED',
  'PRESCRIPTION_SAVED',
  'PRESCRIPTION_SIGNED',
  'PRESCRIPTION_IMAGE_UPLOADED',
  'EXAM_PREPARED',
  'EXAM_PENDING',
  'EXAM_ASSIGNED',
  'EXAM_TRANSFERRED',
  'REPORT_SIGNED',
  'REPORT_RECTIFIED',
  'EXAM_CANCELLED',
] as const
export type OperationalAction = (typeof operationalActions)[number]
export type OperationalMetadata = Record<string, string | number | boolean | null>

@Entity({ name: 'operational_events' })
export class OperationalEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId: string

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId: string

  @Column({ type: 'varchar', length: 60 })
  action: OperationalAction

  @Column({ name: 'resource_type', type: 'varchar', length: 40 })
  resourceType: string

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId: string | null

  @Column({ type: 'varchar', length: 20, default: 'SUCCEEDED' })
  outcome: 'PENDING' | 'SUCCEEDED' | 'FAILED'

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null

  @Column({ type: 'jsonb', default: {} })
  metadata: OperationalMetadata

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null
}
