import { ConflictException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'

export const assertHospitalOriginReceived = async (id: string, manager: EntityManager) => {
  const [result] = await manager.query<Array<{ pending: boolean }>>(`SELECT EXISTS (
    SELECT 1 FROM hospital_intakes i LEFT JOIN upload_sessions u ON u.intake_id=i.id LEFT JOIN dicom_sources s ON s.id=u.source_id
    WHERE i.exam_id=$1 AND (i.status<>'SUBMITTED' OR COALESCE((s.diagnostics->>'pending')::int,0)>0 OR COALESCE((s.diagnostics->>'failed')::int,0)>0)
  ) AS pending`, [id])
  if (result?.pending) throw new ConflictException('O hospital possui arquivos em recebimento ou aguardando conferência.')
}
