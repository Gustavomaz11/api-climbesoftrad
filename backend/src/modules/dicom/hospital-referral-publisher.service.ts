import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { EntityManager } from 'typeorm'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import type { HospitalReferralRouteEntity } from '../../database/entities/hospital-referral-route.entity'
import type { HospitalIntakeEntity } from '../../database/entities/hospital-intake.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { DicomIngestionService, type DicomUploadMetadata } from './dicom-ingestion.service'
import type { HospitalIntakeFieldsDto } from './hospital-intake.dto'

@Injectable()
export class HospitalReferralPublisher {
  constructor(private readonly storage: R2ObjectStorage, private readonly ingestion: DicomIngestionService, private readonly audit: OperationalAuditService) {}
  async publish(source: UploadSessionEntity, intake: HospitalIntakeEntity, route: HospitalReferralRouteEntity,
    fields: HospitalIntakeFieldsDto, actor: CompanyAccessContext, manager: EntityManager) {
    const sessions = manager.getRepository(UploadSessionEntity)
    const recipient: CompanyAccessContext = { ...actor, companyId: route.recipientCompanyId, companyName: '',
      membershipId: null, allUnits: false, unitIds: [route.recipientUnitId], selectedUnitId: route.recipientUnitId,
      isPlatformAdmin: false, integrationSourceId: undefined, permissions: ['dicom.import', 'exams.create', 'exams.view'],
      accessRoleId: '', accessRoleName: 'Encaminhamento hospitalar autorizado' }
    if (source.companyId===route.recipientCompanyId && source.unitId===route.recipientUnitId) {
      source.payload={...source.payload,correction:fields,hospitalIntake:false}
      source.context=recipient
      source.status='APPROVED'
      await sessions.save(source)
      await this.ingestion.ingest(source,source.payload.metadata as DicomUploadMetadata,manager)
      const published=await sessions.findOneByOrFail({id:source.id})
      if (published.status!=='PUBLISHED' || !published.examId) throw new ConflictException('O estudo exige conferência antes do envio.')
      await this.audit.record(recipient,{action:'HOSPITAL_REFERRAL_RECEIVED',resourceType:'exam',resourceId:published.examId,
        unitId:source.unitId,metadata:{intakeId:intake.id,sourceUnitId:source.unitId}},manager)
      return published.examId
    }
    let copy = await sessions.findOneBy({ originUploadId: source.id })
    if (!copy) {
      const storageKey = `ingestion/${route.recipientCompanyId}/${route.recipientUnitId}/referral-${source.id}`
      try {
        await this.storage.copy(source.storageKey, storageKey)
        const object = await this.storage.stat(storageKey)
        if (!object || object.sizeBytes !== source.sizeBytes || object.sha256 !== source.sha256) throw new Error('REFERRAL_INTEGRITY_FAILED')
      } catch { throw new ServiceUnavailableException('Não foi possível transferir os arquivos para a SouRad. O rascunho do hospital foi preservado.') }
      copy = await sessions.save(sessions.create({
        id: randomUUID(), companyId: route.recipientCompanyId, unitId: route.recipientUnitId,
        examId: null, sourceId: null, intakeId: null, originUploadId: source.id, forwardedUploadId: null,
        kind: 'DICOM', name: source.name, contentType: source.contentType, sizeBytes: source.sizeBytes,
        sha256: source.sha256, storageKey, multipartId: 'hospital-referral', status: 'APPROVED', previewOrthancId: source.previewOrthancId,
        payload: { metadata: source.payload.metadata, correction: fields, hospitalIntake: false,
          referral: { intakeId: intake.id, sourceCompanyId: source.companyId, sourceUnitId: source.unitId, sourceUploadId: source.id } },
        context: recipient, expiresAt: new Date(Date.now() + 86400000),
      }))
    }
    if (copy.companyId !== route.recipientCompanyId || copy.unitId !== route.recipientUnitId) throw new ConflictException('Encaminhamento já vinculado a outro destino.')
    await this.ingestion.ingest(copy, copy.payload.metadata as DicomUploadMetadata, manager)
    const result = await sessions.findOneByOrFail({ id: copy.id })
    if (result.status !== 'PUBLISHED' || !result.examId) throw new ConflictException('O estudo exige conferência antes do envio.')
    await sessions.update(source.id, { status: 'FORWARDED', forwardedUploadId: result.id })
    await this.audit.record(recipient, { action: 'HOSPITAL_REFERRAL_RECEIVED', resourceType: 'exam', resourceId: result.examId,
      unitId: route.recipientUnitId, metadata: { sourceCompanyId: source.companyId, sourceUnitId: source.unitId, intakeId: intake.id } }, manager)
    return result.examId
  }
}
