import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, In, type EntityManager } from 'typeorm'
import { HospitalIntakeEntity } from '../../database/entities/hospital-intake.entity'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { DicomStudyEntity } from '../../database/entities/dicom-study.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { HospitalReferralPublisher } from './hospital-referral-publisher.service'
import { HospitalReferralRoutesService } from './hospital-referral-routes.service'
import { stableStudyIdentity } from './dicom-metadata.policy'
import type { SaveHospitalIntakeDto, SubmitHospitalIntakeDto } from './hospital-intake.dto'
import { HospitalReceiptService } from './hospital-receipt.service'
import { receiptLock } from '../document-uploads/hospital-delivery.policy'

@Injectable()
export class HospitalIntakesService {
  constructor(private readonly database: DataSource, private readonly scope: CompanyScopeService,
    private readonly publisher: HospitalReferralPublisher, private readonly audit: OperationalAuditService,
    private readonly routes: HospitalReferralRoutesService, private readonly receipt: HospitalReceiptService) {}

  async list(context: CompanyAccessContext) {
    const rows = await this.database.getRepository(HospitalIntakeEntity).find({
      where: { companyId: context.companyId, ...(context.allUnits ? {} : { unitId: In(context.unitIds) }) },
      order: { updatedAt: 'DESC' }, take: 200,
    })
    if (!rows.length) return []
    const counts = await this.database.getRepository(UploadSessionEntity).createQueryBuilder('u')
      .select('u.intake_id', 'id').addSelect('COUNT(DISTINCT u.sha256)::int', 'count')
      .where('u.intake_id IN (:...ids)', { ids: rows.map(row => row.id) }).groupBy('u.intake_id')
      .getRawMany<{ id: string; count: number }>()
    const destinations = await this.routes.destinations(context)
    const receipts = await this.receipt.states(rows)
    return rows.map(row => ({ ...row, status: receipts.get(row.id)?.receiving ? 'RECEIVING' : row.status, receipt: receipts.get(row.id), destination: destinations.find(destination => destination.unitId === row.unitId) ?? null,
      files: [], fileCount: counts.find(count => count.id === row.id)?.count ?? 0 }))
  }
  async get(id: string, context: CompanyAccessContext) {
    const row = await this.require(id, context, this.database.manager)
    await this.receipt.assertReady(row)
    const destinations = await this.routes.destinations(context)
    return { ...await this.present(row), destination: destinations.find(destination => destination.unitId === row.unitId) ?? null }
  }
  async save(id: string, dto: SaveHospitalIntakeDto, context: CompanyAccessContext) {
    return this.database.transaction(async manager => {
      const row = await this.lock(id, context, manager)
      await this.receipt.assertReady(row, manager)
      this.assertDraft(row, dto.expectedVersion)
      if (row.examId) throw new ConflictException('O estudo já foi enviado. Correções cadastrais devem ser feitas pela equipe SouRad.')
      row.fields = { ...row.fields, ...dto.fields }
      row.version++
      await manager.save(row)
      return row
    })
  }
  async submit(id: string, dto: SubmitHospitalIntakeDto, context: CompanyAccessContext) {
    return this.database.transaction(async manager => {
      const row = await this.lock(id, context, manager)
      if (row.status === 'SUBMITTED') return { id: row.id, examId: row.examId, status: row.status }
      await this.receipt.assertReady(row, manager)
      this.assertDraft(row, dto.expectedVersion)
      if (row.examId && JSON.stringify(Object.entries(row.submittedFields ?? {}).sort()) !== JSON.stringify(Object.entries(dto.fields).sort()))
        throw new ConflictException('O estudo já foi enviado. Preserve os dados conferidos ao enviar imagens complementares; correções devem ser feitas na SouRad.')
      if (!(await this.scope.requireUnit(row.unitId, context)).active) throw new ConflictException('Unidade inativa.')
      const route = await this.routes.require(row, manager)
      row.recipientCompanyId = route.recipientCompanyId
      row.recipientUnitId = route.recipientUnitId
      const uploads = await manager.getRepository(UploadSessionEntity).find({ where: { intakeId: row.id, status: 'AWAITING_REVIEW' }, order: { createdAt: 'ASC' } })
      if (!uploads.length) throw new ConflictException('Aguarde a validação das imagens antes de enviar.')
      for (const upload of uploads) {
        row.examId = await this.publisher.publish(upload, row, route, dto.fields, context, manager)
      }
      // Completion means the hospital explicitly finished this delivery; later arrivals reopen it.
      await manager.getRepository(DicomStudyEntity).update({ companyId: route.recipientCompanyId, unitId: route.recipientUnitId, studyUid: row.studyUid },
        { completedAt: new Date(), completionReason: 'Envio confirmado pelo hospital' })
      row.fields = dto.fields
      row.submittedFields = dto.fields
      row.status = 'SUBMITTED'
      row.version++
      row.submittedAt = new Date()
      row.submittedByUserId = context.userId
      await manager.save(row)
      await this.audit.record(context, { action: 'HOSPITAL_STUDY_SUBMITTED', resourceType: 'hospital-intake',
        resourceId: row.id, unitId: row.unitId, metadata: { examId: row.examId, instances: uploads.length, recipientCompanyId: route.recipientCompanyId, recipientUnitId: route.recipientUnitId } }, manager)
      return { id: row.id, examId: row.examId, status: row.status }
    })
  }
  private assertDraft(row: HospitalIntakeEntity, version: number) {
    if (row.status !== 'DRAFT' || row.version !== version) throw new ConflictException('O estudo foi atualizado. Reabra a conferência para revisar os dados e as novas imagens.')
  }
  private async require(id: string, context: CompanyAccessContext, manager: EntityManager) {
    const row = await manager.getRepository(HospitalIntakeEntity).findOneBy({ id, companyId: context.companyId })
    if (!row) throw new NotFoundException('Estudo hospitalar não encontrado.')
    await this.scope.requireUnit(row.unitId, context)
    return row
  }
  private async lock(id: string, context: CompanyAccessContext, manager: EntityManager) {
    const row = await this.require(id, context, manager)
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [stableStudyIdentity(row.companyId, row.unitId, row.studyUid)])
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [receiptLock(row.companyId, row.unitId)])
    return manager.getRepository(HospitalIntakeEntity).findOneOrFail({ where: { id: row.id }, lock: { mode: 'pessimistic_write' } })
  }
  private async present(row: HospitalIntakeEntity) {
    const repository = this.database.getRepository(UploadSessionEntity)
    const files = await repository.find({
      where: { intakeId: row.id }, select: { id: true, name: true, status: true, sizeBytes: true, validationReason: true, createdAt: true }, order: { createdAt: 'ASC' },
      take: 200,
    })
    const count = await repository.createQueryBuilder('u').select('COUNT(DISTINCT u.sha256)::int', 'count')
      .where('u.intake_id=:id', { id: row.id }).getRawOne<{ count: number }>()
    return { ...row, files, fileCount: count?.count ?? 0 }
  }
}
