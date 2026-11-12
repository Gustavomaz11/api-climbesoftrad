import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import { PatientEntity } from '../../database/entities/patient.entity'
import { PatientUnitEntity } from '../../database/entities/patient-unit.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
@Injectable()
export class PatientScopeService {
  constructor(private readonly database: DataSource) {}
  query(context: CompanyAccessContext, manager: EntityManager = this.database.manager) {
    const q = manager
      .getRepository(PatientEntity)
      .createQueryBuilder('patient')
      .where('patient.company_id=:companyId', { companyId: context.companyId })
    if (!context.allUnits)
      q.andWhere(
        context.unitIds.length
          ? `EXISTS(SELECT 1 FROM patient_units scope WHERE scope.patient_id=patient.id AND scope.unit_id IN (:...unitIds))`
          : '1=0',
        { unitIds: context.unitIds },
      )
    return q
  }
  async require(
    id: string,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    const patient = await this.query(context, manager).andWhere('patient.id=:id', { id }).getOne()
    if (!patient) throw new NotFoundException('Paciente não encontrado.')
    return patient
  }
  async canManage(
    id: string,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    if (context.allUnits) return true
    const units = await manager
      .getRepository(PatientUnitEntity)
      .findBy({ patientId: id, companyId: context.companyId })
    return units.every((unit) => context.unitIds.includes(unit.unitId))
  }
  async assertManage(
    id: string,
    context: CompanyAccessContext,
    manager: EntityManager = this.database.manager,
  ) {
    await this.require(id, context, manager)
    if (!(await this.canManage(id, context, manager)))
      throw new ForbiddenException(
        'Este cadastro também possui vínculos fora das suas unidades. Solicite a conferência por um gestor com acesso completo.',
      )
  }
}
