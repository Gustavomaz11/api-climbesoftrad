import { standardModalities } from '../../modules/exam-modalities/standard-modalities'
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { AuthUserEntity } from './auth-user.entity'
import { HospitalUnitEntity } from './hospital-unit.entity'
import type { WorkflowState } from '../../modules/exam-workflow/workflow.contracts'

export const examModalities = standardModalities.map(item => item.code)

export const examPriorities = [
  'IMEDIATA',
  'PRIORITARIA',
  'EMERGENCIA',
  'URGENTE',
  'ALTA',
  'ROTINA',
] as const

export type ExamModality = (typeof examModalities)[number]
export type ExamPriority = (typeof examPriorities)[number]

@Entity({ name: 'exams' })
export class ExamEntity {
  @Column({ name: 'height_meters', type: 'double precision', nullable: true })
  heightMeters: number | null
  @Column({ name: 'weight_kg', type: 'double precision', nullable: true })
  weightKg: number | null
  @Column({ name: 'study_date', type: 'date', nullable: true })
  studyDate: string | null
  @Column({ name: 'study_time', type: 'varchar', length: 16, nullable: true })
  studyTime: string | null
  @Column({ name: 'institution_name', type: 'varchar', length: 120, nullable: true })
  institutionName: string | null
  @Column({ name: 'study_id', type: 'varchar', length: 64, nullable: true })
  studyId: string | null
  @Column({ name: 'workflow_state', type: 'varchar', length: 20, default: 'TO_PREPARE' })
  workflowState: WorkflowState
  @Column({ name: 'workflow_version', type: 'integer', default: 1 })
  workflowVersion: number
  @Column({ name: 'reporting_user_id', type: 'uuid', nullable: true })
  reportingUserId: string | null
  @Column({ name: 'reporting_started_at', type: 'timestamptz', nullable: true })
  reportingStartedAt: Date | null
  @Column({ name: 'evidence_version', type: 'integer', default: 1 })
  evidenceVersion: number
  @Column({ name: 'prepared_at', type: 'timestamptz', nullable: true })
  preparedAt: Date | null
  @Column({ name: 'prepared_by_user_id', type: 'uuid', nullable: true })
  preparedByUserId: string | null
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null
  @Column({ name: 'archived_by_user_id', type: 'uuid', nullable: true })
  archivedByUserId: string | null
  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string
  @Column({ name: 'encounter_id', type: 'uuid' })
  encounterId: string
  @Column({ name: 'patient_identifier_id', type: 'uuid', nullable: true })
  patientIdentifierId: string | null
  @Column({ name: 'patient_link_decision_id', type: 'uuid', nullable: true })
  patientLinkDecisionId: string | null
  @Column({ name: 'patient_identity_status', type: 'varchar', length: 20 })
  patientIdentityStatus: 'LEGACY' | 'IDENTIFIED' | 'UNIDENTIFIED' | 'SUGGESTION' | 'CONFLICT'
  @Column({ name: 'received_patient_data', type: 'jsonb' })
  receivedPatientData: Record<string, unknown>
  @Column({ name: 'origin_issuer', type: 'varchar', length: 120, nullable: true })
  originIssuer: string | null
  @Column({ name: 'external_patient_id', type: 'varchar', length: 120, nullable: true })
  externalPatientId: string | null
  @Column({ name: 'source_exam_id', type: 'varchar', length: 120, nullable: true })
  sourceExamId: string | null
  @Column({ name: 'source_payload_hash', type: 'varchar', length: 64, nullable: true })
  sourcePayloadHash: string | null
  @Column({ name: 'exam_type_id', type: 'uuid', nullable: true })
  examTypeId: string | null
  @Column({ name: 'normalization_status', type: 'varchar', length: 20 })
  normalizationStatus: 'APPROVED' | 'UNKNOWN' | 'AMBIGUOUS' | 'INACTIVE'
  @Column({ name: 'normalization_alias_id', type: 'uuid', nullable: true })
  normalizationAliasId: string | null
  @Column({ name: 'normalization_rule_version', type: 'integer', nullable: true })
  normalizationRuleVersion: number | null

  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'patient_name', type: 'varchar', length: 120 })
  patientName: string

  @Column({ name: 'social_name', type: 'varchar', length: 120, nullable: true })
  socialName: string | null

  @Column({ type: 'varchar', length: 10 })
  sex: 'MASCULINO' | 'FEMININO'

  @Column({ name: 'birth_date', type: 'date' })
  birthDate: string

  @Column({ type: 'varchar', length: 80, nullable: true })
  identity: string | null

  @Column({ type: 'varchar', length: 80, default: 'Brasil' })
  country: string

  @Column({ type: 'citext', nullable: true })
  email: string | null

  @Column({ name: 'study_description', type: 'varchar', length: 180 })
  studyDescription: string

  @Column({ type: 'varchar', length: 60, nullable: true })
  code: string | null

  @Column({ name: 'accession_number', type: 'varchar', length: 80, nullable: true })
  accessionNumber: string | null

  @Column({ name: 'order_code', type: 'varchar', length: 80, nullable: true })
  orderCode: string | null

  @Column({ type: 'varchar', length: 16 })
  modality: ExamModality

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string

  @ManyToOne(() => HospitalUnitEntity, (unit) => unit.exams, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unit_id' })
  unit: HospitalUnitEntity

  @Column({ type: 'varchar', length: 20, default: 'ROTINA' })
  priority: ExamPriority

  @Column({ name: 'requester_reference', type: 'varchar', length: 140, nullable: true })
  requesterReference: string | null

  @Column({ name: 'requester_name', type: 'varchar', length: 120, nullable: true })
  requesterName: string | null

  @Column({ name: 'performing_physician', type: 'varchar', length: 120, nullable: true })
  performingPhysician: string | null

  @Column({ name: 'health_insurance', type: 'varchar', length: 100, nullable: true })
  healthInsurance: string | null

  @Column({ name: 'performed_at', type: 'timestamptz' })
  performedAt: Date

  @Column({ name: 'auxiliary_field_1', type: 'varchar', length: 160, nullable: true })
  auxiliaryField1: string | null

  @Column({ name: 'auxiliary_field_2', type: 'varchar', length: 160, nullable: true })
  auxiliaryField2: string | null

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string

  @ManyToOne(() => AuthUserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: AuthUserEntity

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
