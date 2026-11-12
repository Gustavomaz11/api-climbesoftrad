import { IsInt, IsUUID, Matches, Min } from 'class-validator'
import type { ReportNode } from './exam-reports.service'
import type { PhysicianSignatureImage } from '../physicians/physician-signature.contract'

export class FinalizeReportDto {
  @IsUUID() signatureId: string
  @IsInt() @Min(1) expectedVersion: number
  @Matches(/^[a-f0-9]{64}$/) contentHash: string
}
export class SendReportDto {
  @IsUUID() completionId: string
}
export interface CompletedSnapshot {
  signature?: PhysicianSignatureImage
  evidenceVersion: number
  content: ReportNode
  presentation: { headerText: string; footerText: string; signatureText: string }
  exam: { id: string; patientName: string; birthDate: string; studyDescription: string; performedAt: string; modality: string; unit: string; unitId: string; companyId: string }
  physician: { name: string; crm: string }
  originUnitName: string | null
}
export interface CompletedReportRow {
  id: string; exam_id: string; company_id: string; unit_id: string; physician_user_id: string
  snapshot: CompletedSnapshot; content_hash: string; finalized_at: Date; sent_at: Date | null
  origin_company_id: string | null; origin_unit_id: string | null
}
