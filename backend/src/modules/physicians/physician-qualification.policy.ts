interface ClassifiedExam {
  unitId: string
  examTypeId: string | null
  modality: string
  normalizationStatus: string
}
interface Qualification {
  unitId: string
  examTypeId: string
  modality: string
  active: boolean
}
export const qualificationMatches = (exam: ClassifiedExam, qualification: Qualification) =>
  exam.normalizationStatus === 'APPROVED' &&
  Boolean(exam.examTypeId) &&
  qualification.active &&
  exam.unitId === qualification.unitId &&
  exam.examTypeId === qualification.examTypeId &&
  exam.modality === qualification.modality
