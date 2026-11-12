import type { CompanyAccessContext } from '../companies/company-context.contracts'

export const researchPromptVersion = 'visual-research-3'
export const anonymizationVersion = 'png-background-text-human-2'
export type ResearchStatus =
  'PREPARING' | 'REVIEW' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STALE'
export interface Redaction {
  x: number
  y: number
  width: number
  height: number
}
export interface ResearchFinding {
  imageId: string
  label: string
  description: string
  box: number[]
}
export interface ResearchResult {
  imageAssessments?: ResearchImageAssessment[]
  summary: string
  limitations: string[]
  imagesReviewed: string[]
  findings: ResearchFinding[]
}
export interface ResearchImageAssessment {
  imageId: string
  localizationStatus: 'LOCALIZED' | 'NO_LOCALIZATION' | 'UNASSESSABLE'
  description: string
}
export interface ResearchSource {
  instanceId: string
  orthancId: string | null
  instanceUid: string
  sha256: string
}
export interface ResearchCase {
  source_case_id?: string | null
  id: string
  company_id: string
  unit_id: string
  exam_id: string
  created_by_user_id: string
  context: CompanyAccessContext
  source_hash: string
  source_snapshot: ResearchSource[]
  status: ResearchStatus
  model: string
  prompt_version: string
  anonymization_version: string
  frames_expected: number
  frames_prepared: number
  batches_completed: number
  result: ResearchResult | null
  error_code: string | null
  created_at: Date
  updated_at: Date
}
export interface ResearchFrame {
  instance_uid: string
  series_uid: string
  study_uid: string
  id: string
  case_id: string
  instance_id: string
  frame_index: number
  sequence: number
  width: number
  height: number
  base_key: string
  redacted_key: string
  masks: Redaction[]
  automatic_masks: Redaction[]
  revision: number
  reviewed_revision: number | null
  sha256: string
}

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max
export const validateResearchResult = (
  input: unknown,
  images: string[],
  requireAssessments = false,
): ResearchResult => {
  if (!input || typeof input !== 'object') throw new Error('RESULT_INVALID')
  const value = input as Record<string, unknown>
  if (
    !text(value.summary, 6000) ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > 30 ||
    !value.limitations.every((item) => text(item, 1000)) ||
    !Array.isArray(value.findings) ||
    value.findings.length > 200 ||
    !Array.isArray(value.imagesReviewed)
  )
    throw new Error('RESULT_INVALID')
  const reviewed = value.imagesReviewed as unknown[]
  if (
    reviewed.length !== images.length ||
    new Set(reviewed).size !== images.length ||
    images.some((id) => !reviewed.includes(id))
  )
    throw new Error('COVERAGE_INCOMPLETE')
  const findings = value.findings as Array<Record<string, unknown>>
  for (const finding of findings) {
    if (
      !finding ||
      typeof finding !== 'object' ||
      typeof finding.imageId !== 'string' ||
      !images.includes(finding.imageId) ||
      !text(finding.label, 180) ||
      !text(finding.description, 3000) ||
      !Array.isArray(finding.box) ||
      finding.box.length !== 4 ||
      !finding.box.every(
        (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000,
      ) ||
      finding.box[0] >= finding.box[2] ||
      finding.box[1] >= finding.box[3]
    )
      throw new Error('RESULT_INVALID')
  }
  let assessments: ResearchImageAssessment[] | undefined
  if (requireAssessments || value.imageAssessments !== undefined) {
    if (!Array.isArray(value.imageAssessments) || value.imageAssessments.length !== images.length)
      throw new Error('COVERAGE_INCOMPLETE')
    const rows = value.imageAssessments as Array<Record<string, unknown>>
    if (new Set(rows.map((row) => row?.imageId)).size !== images.length)
      throw new Error('COVERAGE_INCOMPLETE')
    for (const row of rows) {
      if (
        !row ||
        typeof row.imageId !== 'string' ||
        !images.includes(row.imageId) ||
        !text(row.description, 3000) ||
        !row.description.trim() ||
        !['LOCALIZED', 'NO_LOCALIZATION', 'UNASSESSABLE'].includes(String(row.localizationStatus))
      )
        throw new Error('RESULT_INVALID')
      const hasRegions = findings.some((f) => f.imageId === row.imageId)
      if ((row.localizationStatus === 'LOCALIZED') !== hasRegions) throw new Error('RESULT_INVALID')
    }
    assessments = images.map(
      (id) => rows.find((row) => row.imageId === id) as unknown as ResearchImageAssessment,
    )
  }
  return {
    ...(assessments ? { imageAssessments: assessments } : {}),
    summary: value.summary,
    limitations: value.limitations,
    imagesReviewed: images,
    findings: findings as unknown as ResearchFinding[],
  }
}
