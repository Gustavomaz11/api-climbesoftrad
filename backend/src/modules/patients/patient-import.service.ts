import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import { isUUID } from 'class-validator'
import { DataSource } from 'typeorm'
import { PatientImportBatchEntity } from '../../database/entities/patient-import-batch.entity'
import { PatientImportRowEntity } from '../../database/entities/patient-import-row.entity'
import { PatientImportValidationService } from './patient-import-validation.service'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { parsePatientIdentifierCsv, collidingImportLines } from './patient-import-csv'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { PatientImportRunnerService } from './patient-import-runner.service'
import type { UndoImportRowDto, ReviewImportRowDto } from './dto/patient-import.dto'
@Injectable()
export class PatientImportService {
  constructor(
    private readonly database: DataSource,
    private readonly validation: PatientImportValidationService,
    private readonly runner: PatientImportRunnerService,
    private readonly units: CompanyScopeService,
    private readonly audit: OperationalAuditService,
  ) {}
  async preview(name: string, text: string, context: CompanyAccessContext) {
    let parsed
    try {
      parsed = parsePatientIdentifierCsv(text)
    } catch (error: unknown) {
      throw new BadRequestException(error instanceof Error ? error.message : 'CSV inválido.')
    }
    const unitIds = [...new Set(parsed.map((row) => row.unitId).filter((id) => isUUID(id)))]
    for (const id of unitIds) await this.units.requireUnit(id, context)
    const hash = createHash('sha256').update(text).digest('hex')
    const collisions = collidingImportLines(parsed)
    const batch = await this.database.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        context.companyId + ':import:' + hash,
      ])
      const repo = manager.getRepository(PatientImportBatchEntity)
      const previous = await repo.findOneBy({ companyId: context.companyId, contentHash: hash })
      if (previous) return previous
      const batch = await repo.save(
        repo.create({
          companyId: context.companyId,
          name: name.slice(0, 120),
          contentHash: hash,
          status: 'PREVIEW',
          unitIds,
          createdByUserId: context.userId,
        }),
      )
      for (const [index, data] of parsed.entries()) {
        const result = collisions.has(index)
          ? {
              status: 'CONFLICT',
              message: 'O CSV atribui o mesmo identificador a pacientes diferentes.',
            }
          : await this.validation.validate(data, context, manager)
        await manager.getRepository(PatientImportRowEntity).save({
          companyId: context.companyId,
          batchId: batch.id,
          line: index + 2,
          data,
          status: result.status,
          message: result.message,
          included: false,
          version: 0,
          result: null,
        })
      }
      await this.audit.record(
        context,
        {
          action: 'PATIENT_IMPORT_PREVIEWED',
          resourceType: 'patient_import',
          resourceId: batch.id,
          metadata: { rowCount: parsed.length },
        },
        manager,
      )
      return batch
    })
    return this.get(batch.id, context)
  }
  async list(context: CompanyAccessContext) {
    const batches = await this.database
      .getRepository(PatientImportBatchEntity)
      .find({ where: { companyId: context.companyId }, order: { createdAt: 'DESC' }, take: 50 })
    return batches.filter(
      (batch) =>
        context.allUnits ||
        (batch.unitIds.length
          ? batch.unitIds.every((id) => context.unitIds.includes(id))
          : batch.createdByUserId === context.userId),
    )
  }
  async get(id: string, context: CompanyAccessContext) {
    const batch = await this.require(id, context)
    const rows = await this.database
      .getRepository(PatientImportRowEntity)
      .find({ where: { batchId: id, companyId: context.companyId }, order: { line: 'ASC' } })
    const counts: Record<string, number> = {}
    for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1
    return { batch, rows, counts }
  }
  async reviewRow(
    id: string,
    rowId: string,
    dto: ReviewImportRowDto,
    context: CompanyAccessContext,
  ) {
    await this.require(id, context)
    await this.database.transaction(async (manager) => {
      const repo = manager.getRepository(PatientImportRowEntity)
      const row = await repo.findOne({
        where: { id: rowId, batchId: id, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row) throw new NotFoundException('Linha não encontrada.')
      if (row.version !== dto.expectedVersion || row.status === 'APPLIED')
        throw new ConflictException('Linha alterada ou já importada.')
      if (dto.data)
        row.data = {
          ...dto.data,
          issuer: dto.data.issuer.trim(),
          legacyIssuer: dto.data.legacyIssuer.trim(),
        }
      const unit = await this.units.requireUnit(row.data.unitId, context)
      if (!unit.active) throw new BadRequestException('Unidade inativa.')
      const validation = await this.validation.validate(row.data, context, manager)
      Object.assign(row, {
        included: dto.included && validation.status === 'READY',
        status: dto.included ? validation.status : 'REJECTED',
        message: dto.included ? validation.message : dto.reason,
        version: row.version + 1,
      })
      await repo.save(row)
      const batch = await manager.getRepository(PatientImportBatchEntity).findOneByOrFail({ id })
      if (!batch.unitIds.includes(row.data.unitId)) {
        batch.unitIds.push(row.data.unitId)
        await manager.getRepository(PatientImportBatchEntity).save(batch)
      }
      await this.audit.record(
        context,
        {
          action: 'PATIENT_IMPORT_REVIEWED',
          resourceType: 'patient_import',
          resourceId: id,
          reason: dto.reason,
          metadata: { rowId, included: row.included },
        },
        manager,
      )
    })
    return this.get(id, context)
  }
  async approveReady(id: string, context: CompanyAccessContext) {
    await this.require(id, context)
    await this.database.transaction(async (manager) => {
      const repo = manager.getRepository(PatientImportRowEntity)
      const rows = await repo
        .createQueryBuilder('row')
        .where(
          'row.batch_id=:id AND row.company_id=:companyId AND row.status=:status AND NOT row.included',
          { id, companyId: context.companyId, status: 'READY' },
        )
        .orderBy('row.line', 'ASC')
        .setLock('pessimistic_write')
        .getMany()
      for (const row of rows) {
        const validation = await this.validation.validate(row.data, context, manager)
        Object.assign(row, {
          status: validation.status,
          message: validation.message,
          included: validation.status === 'READY',
          version: row.version + 1,
        })
        await repo.save(row)
      }
      await this.audit.record(
        context,
        {
          action: 'PATIENT_IMPORT_REVIEWED',
          resourceType: 'patient_import',
          resourceId: id,
          reason: 'Linhas válidas aprovadas na prévia',
          metadata: { rowCount: rows.length },
        },
        manager,
      )
    })
    return this.get(id, context)
  }
  async commit(id: string, limit: number, context: CompanyAccessContext) {
    await this.require(id, context)
    for (let index = 0; index < limit; index++) {
      const processed = await this.database.transaction((manager) =>
        this.runner.applyNext(id, context, manager),
      )
      if (!processed) break
    }
    const report = await this.get(id, context)
    const pending = report.rows.some((row) => row.included && row.status === 'READY')
    await this.database.getRepository(PatientImportBatchEntity).update(id, {
      status: pending
        ? 'IN_PROGRESS'
        : report.rows.some((row) => ['INVALID', 'CONFLICT', 'READY'].includes(row.status))
          ? 'NEEDS_REVIEW'
          : 'COMPLETED',
    })
    return this.get(id, context)
  }
  async undoRow(id: string, rowId: string, dto: UndoImportRowDto, context: CompanyAccessContext) {
    await this.require(id, context)
    await this.database.transaction((manager) => this.runner.undo(id, rowId, dto, context, manager))
    return this.get(id, context)
  }
  private async require(id: string, context: CompanyAccessContext) {
    const batch = await this.database
      .getRepository(PatientImportBatchEntity)
      .findOneBy({ id, companyId: context.companyId })
    if (!batch) throw new NotFoundException('Importação não encontrada.')
    if (
      !context.allUnits &&
      (!batch.unitIds.every((unit) => context.unitIds.includes(unit)) ||
        (!batch.unitIds.length && batch.createdByUserId !== context.userId))
    )
      throw new ForbiddenException('Importação contém unidades fora do seu contexto.')
    return batch
  }
}
