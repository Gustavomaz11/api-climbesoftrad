import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { type EntityManager, In } from 'typeorm'
import { ExamEntity } from '../../database/entities/exam.entity'
import { PatientImportRowEntity } from '../../database/entities/patient-import-row.entity'
import { PatientIdentifierEntity } from '../../database/entities/patient-identifier.entity'
import { PatientUnitEntity } from '../../database/entities/patient-unit.entity'
import { PatientEntity } from '../../database/entities/patient.entity'
import { PatientScopeService } from './patient-scope.service'
import { PatientImportValidationService } from './patient-import-validation.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { identifierImportKeys } from './patient-import-csv'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { UndoImportRowDto } from './dto/patient-import.dto'
@Injectable()
export class PatientImportRunnerService {
  constructor(
    private readonly validation: PatientImportValidationService,
    private readonly scope: PatientScopeService,
    private readonly audit: OperationalAuditService,
  ) {}
  async applyNext(batchId: string, context: CompanyAccessContext, manager: EntityManager) {
    const repo = manager.getRepository(PatientImportRowEntity)
    const row = await repo
      .createQueryBuilder('row')
      .where(
        `row.batch_id=:batchId AND row.company_id=:companyId AND row.included AND row.status='READY'`,
        { batchId, companyId: context.companyId },
      )
      .orderBy('row.line', 'ASC')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getOne()
    if (!row) return false
    const keys = identifierImportKeys(row.data).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    )
    for (const key of keys)
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify([context.companyId, row.data.unitId, key.issuer, key.value]),
      ])
    await manager.getRepository(PatientEntity).findOneOrFail({
      where: { id: row.data.patientId, companyId: context.companyId },
      lock: { mode: 'pessimistic_write' },
    })
    const validation = await this.validation.validate(row.data, context, manager)
    if (validation.status !== 'READY') {
      Object.assign(row, {
        status: validation.status,
        message: validation.message,
        version: row.version + 1,
      })
      await repo.save(row)
      return true
    }
    await manager
      .getRepository(PatientUnitEntity)
      .upsert(
        { companyId: context.companyId, patientId: row.data.patientId, unitId: row.data.unitId },
        ['patientId', 'unitId'],
      )
    const identifiers = manager.getRepository(PatientIdentifierEntity)
    const result: string[] = []
    const created: string[] = []
    for (const key of keys) {
      let identifier = await identifiers.findOneBy({
        companyId: context.companyId,
        unitId: row.data.unitId,
        issuer: key.issuer,
        originalValue: key.value,
      })
      if (!identifier) {
        identifier = await identifiers.save(
          identifiers.create({
            companyId: context.companyId,
            unitId: row.data.unitId,
            patientId: row.data.patientId,
            issuer: key.issuer,
            originalValue: key.value,
            source: 'IMPORT',
            reliable: true,
            version: 0,
            lastDecisionId: null,
          }),
        )
        created.push(identifier.id)
      }
      result.push(identifier.id)
    }
    Object.assign(row, {
      status: 'APPLIED',
      version: row.version + 1,
      result: { identifierIds: result, createdIdentifierIds: created },
      message: 'Mapeamento importado.',
    })
    await repo.save(row)
    await this.audit.record(
      context,
      {
        action: 'PATIENT_IMPORT_ROW_APPLIED',
        resourceType: 'patient_import',
        resourceId: batchId,
        unitId: row.data.unitId,
        metadata: { rowId: row.id, patientId: row.data.patientId, identifierCount: result.length },
      },
      manager,
    )
    return true
  }

  async undo(
    batchId: string,
    rowId: string,
    dto: UndoImportRowDto,
    context: CompanyAccessContext,
    manager: EntityManager,
  ) {
    const rows = manager.getRepository(PatientImportRowEntity)
    const row = await rows.findOne({
      where: { id: rowId, batchId, companyId: context.companyId },
      lock: { mode: 'pessimistic_write' },
    })
    if (!row) throw new NotFoundException('Linha não encontrada.')
    if (row.status !== 'APPLIED' || row.version !== dto.expectedVersion)
      throw new ConflictException('Linha alterada ou não importada.')
    const result = row.result as { createdIdentifierIds?: string[] } | null
    const created = result?.createdIdentifierIds ?? []
    for (const key of identifierImportKeys(row.data).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ))
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify([context.companyId, row.data.unitId, key.issuer, key.value]),
      ])
    await manager.getRepository(PatientEntity).findOneOrFail({
      where: { id: row.data.patientId, companyId: context.companyId },
      lock: { mode: 'pessimistic_write' },
    })
    await this.scope.assertManage(row.data.patientId, context, manager)
    if (created.length) {
      const identifiers = manager.getRepository(PatientIdentifierEntity)
      const existing = await identifiers.findBy({ id: In(created), companyId: context.companyId })
      if (
        existing.length !== created.length ||
        existing.some((i) => i.patientId !== row.data.patientId || i.lastDecisionId)
      )
        throw new ConflictException(
          'Identificador alterado após a importação. Faça conferência do paciente.',
        )
      if (
        await manager
          .getRepository(ExamEntity)
          .existsBy({ companyId: context.companyId, patientIdentifierId: In(created) })
      )
        throw new ConflictException(
          'Identificador já utilizado em exames. Faça conferência do paciente antes de corrigir.',
        )
      const [dependency] = await manager.query<Array<{ used: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM patient_import_rows WHERE company_id=$1 AND id<>$2 AND status='APPLIED' AND (result->'identifierIds') ?| $3::text[]) AS used`,
        [context.companyId, row.id, created],
      )
      if (dependency?.used)
        throw new ConflictException(
          'Identificador utilizado por outra linha importada. Desfaça primeiro a linha dependente.',
        )
      await identifiers.delete({ id: In(created), companyId: context.companyId })
    }
    row.status = 'REJECTED'
    row.included = false
    row.message = dto.reason
    row.version++
    await rows.save(row)
    await this.audit.record(
      context,
      {
        action: 'PATIENT_IMPORT_ROW_REVERTED',
        resourceType: 'patient_import',
        resourceId: batchId,
        unitId: row.data.unitId,
        reason: dto.reason,
        metadata: { rowId, removedIdentifierIds: created.join(',') },
      },
      manager,
    )
  }
}
