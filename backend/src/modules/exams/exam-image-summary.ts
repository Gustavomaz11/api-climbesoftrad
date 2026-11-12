import type { DataSource } from 'typeorm'
export const examImageSummaries = async (database: DataSource, examIds: string[]) => {
  const rows = await database.query<
    Array<{
      examId: string
      imageStatus: string
      imageInstanceCount: number
      imageSeriesCount: number
      lastImageReceivedAt: Date | null
    }>
  >(
    `SELECT s.exam_id AS "examId",
    CASE WHEN bool_and(s.completed_at IS NOT NULL) THEN 'RECEIVED' ELSE 'RECEIVING' END AS "imageStatus",
    COUNT(DISTINCT i.id)::int AS "imageInstanceCount",COUNT(DISTINCT i.series_id)::int AS "imageSeriesCount",
    max(s.last_received_at) AS "lastImageReceivedAt" FROM dicom_studies s LEFT JOIN dicom_instances i ON i.study_id=s.id WHERE s.exam_id=ANY($1::uuid[]) GROUP BY s.exam_id`,
    [examIds],
  )
  return new Map(rows.map((row) => [row.examId, row]))
}
