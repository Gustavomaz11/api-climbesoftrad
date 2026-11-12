import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import { isUUID } from 'class-validator'
import { PatientIdentifierEntity } from '../../database/entities/patient-identifier.entity'
import type { ImportedIdentifierRow } from '../../database/entities/patient-import-row.entity'
import { PatientScopeService } from './patient-scope.service'
import { CompanyScopeService } from '../companies/company-scope.service'
import { identifierImportKeys } from './patient-import-csv'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
@Injectable()
export class PatientImportValidationService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: PatientScopeService,
    private readonly units: CompanyScopeService,
  ) {}
  async validate(
    row: ImportedIdentifierRow,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    if (
      !isUUID(row.unitId) ||
      !isUUID(row.patientId) ||
      row.issuer.trim().length < 2 ||
      row.issuer.length > 120 ||
      !row.externalId.trim() ||
      row.externalId.length > 120 ||
      Boolean(row.legacyIssuer) !== Boolean(row.legacyExternalId) ||
      row.legacyIssuer.length > 120 ||
      row.legacyExternalId.length > 120 ||
      (Boolean(row.legacyIssuer) &&
        (row.legacyIssuer.trim().length < 2 || !row.legacyExternalId.trim()))
    )
      return {
        status: 'INVALID',
        message: 'Dados ausentes ou inválidos. Confira paciente, origem e identificadores.',
      }
    try {
      const unit = await this.units.requireUnit(row.unitId, context)
      if (!unit.active) return { status: 'INVALID', message: 'Unidade inativa.' }
      const patient = await this.scope.require(row.patientId, context, manager)
      await this.scope.assertManage(patient.id, context, manager)
      if (patient.mergedIntoId)
        return { status: 'CONFLICT', message: 'Cadastro associado. Escolha o paciente atual.' }
      let existingCount = 0
      for (const key of identifierImportKeys(row)) {
        const identifier = await manager.getRepository(PatientIdentifierEntity).findOneBy({
          companyId: context.companyId,
          unitId: row.unitId,
          issuer: key.issuer,
          originalValue: key.value,
        })
        if (identifier && identifier.patientId !== patient.id)
          return {
            status: 'CONFLICT',
            message:
              'Identificador associado a outro cadastro. Faça a conferência antes de importar.',
          }
        if (identifier) existingCount++
      }
      return existingCount === identifierImportKeys(row).length
        ? { status: 'ALREADY_LINKED', message: 'Mapeamento já existente.' }
        : { status: 'READY', message: null }
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException)
        return {
          status: 'INVALID',
          message: 'Paciente ou unidade inacessível para esta importação.',
        }
      throw error
    }
  }
}
