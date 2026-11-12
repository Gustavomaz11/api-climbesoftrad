import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import type { HospitalIntakeEntity } from '../../database/entities/hospital-intake.entity'

interface ReceiptFile {
  intake: string | null
  unit: string
  delivery: string | null
  item: string | null
  total: number | null
  status: string
  source: string | null
}
export interface HospitalReceipt {
  receiving: boolean
  expected: number | null
  validated: number
  failed: number
}
const accepted = new Set(['AWAITING_REVIEW', 'FORWARDED', 'PUBLISHED'])

@Injectable()
export class HospitalReceiptService {
  constructor(private readonly db: DataSource) {}
  async states(rows: HospitalIntakeEntity[], manager: EntityManager = this.db.manager) {
    const result = new Map<string, HospitalReceipt>()
    if (!rows.length) return result
    const columns = `intake_id AS intake,unit_id AS unit,payload->>'deliveryId' AS delivery,payload->>'deliveryFileId' AS item,
      (payload->>'deliveryTotal')::int AS total,status,source_id AS source`
    const linked = await manager.query<ReceiptFile[]>(
      `SELECT ${columns} FROM upload_sessions WHERE intake_id=ANY($1::uuid[])`,
      [rows.map((r) => r.id)],
    )
    const deliveries = [...new Set(linked.map((f) => f.delivery).filter(Boolean))]
    const files = deliveries.length
      ? await manager.query<ReceiptFile[]>(
          `SELECT ${columns} FROM upload_sessions WHERE company_id=$1 AND payload->>'deliveryId'=ANY($2::text[])`,
          [rows[0]!.companyId, deliveries],
        )
      : []
    // Earlier clients did not declare a manifest. Keep their studies blocked
    // while uploads or the durable agent queue are still pending.
    const legacyPending = await manager.query<Array<{ unit: string }>>(
      `SELECT DISTINCT unit_id AS unit FROM upload_sessions WHERE company_id=$1 AND unit_id=ANY($2::uuid[])
       AND payload->>'hospitalIntake'='true' AND payload->>'deliveryId' IS NULL AND status IN ('UPLOADING','RECEIVED','VALIDATING','APPROVED')`,
      [rows[0]!.companyId, [...new Set(rows.map((r) => r.unitId))]],
    )
    const sources = await manager.query<
      Array<{ id: string; pending: string | null; failed: string | null }>
    >(
      `SELECT id,diagnostics->>'pending' AS pending,diagnostics->>'failed' AS failed FROM dicom_sources WHERE id=ANY($1::uuid[])`,
      [[...new Set(linked.map((f) => f.source).filter(Boolean))]],
    )
    for (const row of rows) {
      const own = linked.filter((f) => f.intake === row.id),
        batchIds = [...new Set(own.map((f) => f.delivery).filter(Boolean))]
      let expected = 0,
        validated = 0,
        failed = 0,
        receiving = false
      for (const batchId of batchIds) {
        const batch = files.filter((f) => f.unit === row.unitId && f.delivery === batchId)
        const total = Math.max(0, ...batch.map((f) => f.total ?? 0))
        const good = new Set(batch.filter((f) => accepted.has(f.status)).map((f) => f.item))
        const bad = new Set(
          batch
            .filter(
              (f) =>
                ['REJECTED', 'QUARANTINED', 'CANCELLED', 'EXPIRED'].includes(f.status) &&
                !good.has(f.item),
            )
            .map((f) => f.item),
        )
        expected += total
        validated += good.size
        failed += bad.size
        receiving ||= total === 0 || good.size !== total
      }
      receiving ||= legacyPending.some((p) => p.unit === row.unitId)
      // A folder source must also finish files still being copied/discovered
      // locally; they do not yet have a cloud upload or a parsed Study UID.
      receiving ||= own.some((f) =>
        sources.some((s) => s.id === f.source && (Number(s.pending) > 0 || Number(s.failed) > 0)),
      )
      result.set(row.id, {
        receiving: row.status !== 'SUBMITTED' && receiving,
        expected: batchIds.length ? expected : null,
        validated,
        failed,
      })
    }
    return result
  }
  async assertReady(row: HospitalIntakeEntity, manager: EntityManager = this.db.manager) {
    if ((await this.states([row], manager)).get(row.id)?.receiving)
      throw new ConflictException(
        'Recebendo Exame. Aguarde o recebimento e a validação de todos os arquivos antes de conferir ou enviar.',
      )
  }
}
