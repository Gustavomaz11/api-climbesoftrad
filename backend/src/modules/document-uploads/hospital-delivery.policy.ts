import { BadRequestException, ConflictException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { CreateUploadDto } from './upload.dto'

export const receiptLock = (companyId: string, unitId: string) =>
  `hospital-receipt:${companyId}:${unitId}`
export const validateHospitalDelivery = async (
  manager: EntityManager,
  dto: CreateUploadDto,
  context: CompanyAccessContext,
  hospital: boolean,
) => {
  const supplied = [dto.deliveryId, dto.deliveryFileId, dto.deliveryTotal].filter(
    (v) => v !== undefined,
  ).length
  if (!supplied) return
  if (supplied !== 3 || !hospital)
    throw new BadRequestException('Informe o lote hospitalar completo.')
  // Also serializes new uploads against the hospital's final submission check.
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    receiptLock(context.companyId, dto.unitId),
  ])
  const rows = await manager.query<
    Array<{ total: number; file: string; sha256: string; owner: string; source: string | null }>
  >(
    `SELECT (payload->>'deliveryTotal')::int AS total,payload->>'deliveryFileId' AS file,sha256,context->>'userId' AS owner,source_id AS source
     FROM upload_sessions WHERE company_id=$1 AND unit_id=$2 AND payload->>'deliveryId'=$3`,
    [context.companyId, dto.unitId, dto.deliveryId],
  )
  if (
    rows.some(
      (r) =>
        r.total !== dto.deliveryTotal ||
        r.owner !== context.userId ||
        r.source !== (dto.sourceId ?? null),
    )
  )
    throw new ConflictException('O lote pertence a outro envio ou tem quantidade divergente.')
  if (rows.some((r) => r.file === dto.deliveryFileId && r.sha256 !== dto.sha256))
    throw new ConflictException('O arquivo deste lote tem conteúdo divergente.')
  if (
    !rows.some((r) => r.file === dto.deliveryFileId) &&
    new Set(rows.map((r) => r.file)).size >= dto.deliveryTotal!
  )
    throw new ConflictException('O lote já contém todos os arquivos declarados.')
}
