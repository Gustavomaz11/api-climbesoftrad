import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { DataSource, In, type EntityManager } from 'typeorm'
import { HospitalReferralRouteEntity } from '../../database/entities/hospital-referral-route.entity'
import { HospitalUnitEntity } from '../../database/entities/hospital-unit.entity'
import { CompanyEntity } from '../../database/entities/company.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { HospitalIntakeEntity } from '../../database/entities/hospital-intake.entity'
import type { ConfigureHospitalReferralDto } from './hospital-referral.dto'

@Injectable()
export class HospitalReferralRoutesService {
  constructor(private readonly database: DataSource, private readonly scope: CompanyScopeService, private readonly audit: OperationalAuditService) {}
  list(context: CompanyAccessContext) {
    return this.database.getRepository(HospitalReferralRouteEntity).find({ where: {
      companyId: context.companyId, ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
    } })
  }
  async destinations(context: CompanyAccessContext) {
    const routes = await this.list(context)
    if (context.companyId===this.scope.centralCompanyId && !routes.length) {
      const units=await this.database.getRepository(HospitalUnitEntity).find({where:{companyId:context.companyId,active:true,...(context.allUnits ? {} : {id:In(context.unitIds)})}})
      return units.map(unit=>({unitId:unit.id,companyId:context.companyId,companyName:'SouRad',recipientUnitId:unit.id,unitName:unit.name}))
    }
    const active = routes.filter(route => route.active)
    if (!active.length) return []
    const companies = await this.database.getRepository(CompanyEntity).findBy({ id: In(active.map(route => route.recipientCompanyId)), active: true })
    const units = await this.database.getRepository(HospitalUnitEntity).findBy({ id: In(active.map(route => route.recipientUnitId)), active: true })
    return active.flatMap(route => {
      const company = companies.find(item => item.id === route.recipientCompanyId), unit = units.find(item => item.id === route.recipientUnitId)
      return company && unit ? [{ unitId: route.unitId, companyId: company.id, companyName: company.name, recipientUnitId: unit.id, unitName: unit.name }] : []
    })
  }
  async configure(dto: ConfigureHospitalReferralDto, context: CompanyAccessContext) {
    if (!context.isPlatformAdmin) throw new ForbiddenException('Somente a administração da plataforma pode autorizar encaminhamentos entre empresas.')
    await this.scope.requireUnit(dto.unitId, context)
    if (dto.recipientCompanyId === context.companyId) throw new BadRequestException('O destinatário deve ser outra empresa.')
    return this.database.transaction(async manager => {
      await this.assertRecipient(dto.recipientCompanyId, dto.recipientUnitId, manager)
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`hospital-route:${context.companyId}:${dto.unitId}`])
      const repository = manager.getRepository(HospitalReferralRouteEntity)
      const previous = await repository.findOneBy({ companyId: context.companyId, unitId: dto.unitId })
      const route = await repository.save({ ...previous, companyId: context.companyId, unitId: dto.unitId,
        recipientCompanyId: dto.recipientCompanyId, recipientUnitId: dto.recipientUnitId,
        active: dto.active ?? true, createdByUserId: previous?.createdByUserId ?? context.userId })
      await this.audit.record(context, { action: 'HOSPITAL_REFERRAL_ROUTE_CONFIGURED', resourceType: 'hospital-referral-route', resourceId: route.id, unitId: dto.unitId,
        metadata: { recipientCompanyId: route.recipientCompanyId, recipientUnitId: route.recipientUnitId, active: route.active } }, manager)
      return route
    })
  }
  async require(intake: HospitalIntakeEntity, manager: EntityManager) {
    const route = await manager.getRepository(HospitalReferralRouteEntity).findOne({
      where: { companyId: intake.companyId, unitId: intake.unitId }, lock: { mode: 'pessimistic_read' },
    })
    if (route && !route.active) throw new ConflictException('O envio deste hospital está desativado. Consulte a administração SouRad.')
    if (!route && intake.companyId===this.scope.centralCompanyId) {
      await this.assertRecipient(intake.companyId,intake.unitId,manager)
      return Object.assign(new HospitalReferralRouteEntity(),{companyId:intake.companyId,unitId:intake.unitId,
        recipientCompanyId:intake.companyId,recipientUnitId:intake.unitId,active:true})
    }
    if (!route) throw new ConflictException('Configure um encaminhamento ativo do hospital para a SouRad antes de enviar.')
    if (intake.examId && (intake.recipientCompanyId !== route.recipientCompanyId || intake.recipientUnitId !== route.recipientUnitId))
      throw new ConflictException('O destino do estudo já enviado foi alterado. A administração precisa conferir o encaminhamento.')
    await this.assertRecipient(route.recipientCompanyId, route.recipientUnitId, manager)
    return route
  }
  private async assertRecipient(companyId: string, unitId: string, manager: EntityManager) {
    const company = await manager.getRepository(CompanyEntity).findOneBy({ id: companyId, active: true })
    const unit = await manager.getRepository(HospitalUnitEntity).findOneBy({ id: unitId, companyId, active: true })
    if (!company || !unit) throw new ConflictException('Empresa ou unidade destinatária indisponível.')
  }
}
