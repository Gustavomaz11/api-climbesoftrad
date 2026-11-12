import type { EntityManager } from 'typeorm'

export const clearCompanyReportPresence = async (
  manager: EntityManager,
  companyId: string,
  userId: string,
  allowedUnitIds?: string[],
) => {
  await manager.query(
    `
    DELETE FROM exam_report_presences presence USING exams exam
    WHERE presence.exam_id = exam.id AND exam.company_id = $1 AND presence.user_id = $2
      ${allowedUnitIds ? 'AND NOT (exam.unit_id = ANY($3::uuid[]))' : ''}
  `,
    allowedUnitIds ? [companyId, userId, allowedUnitIds] : [companyId, userId],
  )
}
