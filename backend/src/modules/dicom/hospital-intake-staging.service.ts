import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { HospitalIntakeEntity } from '../../database/entities/hospital-intake.entity'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { DicomInstanceEntity } from '../../database/entities/dicom-instance.entity'
import { StoredObjectEntity } from '../../database/entities/stored-object.entity'
import { stableStudyIdentity } from './dicom-metadata.policy'
import type { DicomUploadMetadata } from './dicom-ingestion.service'
import { dicomStudyDetailFields } from './dicom-study-details.policy'

@Injectable()
export class HospitalIntakeStagingService {
  constructor(private readonly database: DataSource) {}
  async stage(upload: UploadSessionEntity, metadata: DicomUploadMetadata) {
    return this.database.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        stableStudyIdentity(upload.companyId, upload.unitId, metadata.tags.studyUid),
      ])
      const sessions = manager.getRepository(UploadSessionEntity)
      const locked = await sessions.findOneOrFail({ where: { id: upload.id }, lock: { mode: 'pessimistic_write' } })
      if (locked.status !== 'APPROVED') return
      const repository = manager.getRepository(HospitalIntakeEntity)
      let intake = await repository.findOneBy({ companyId: upload.companyId, unitId: upload.unitId, studyUid: metadata.tags.studyUid })
      if (intake && intake.identityHash !== metadata.identityHash) throw new ConflictException('Identidade divergente no mesmo estudo. Confira a origem dos arquivos.')
      if (intake) {
        const forwarded = await sessions.findOneBy({ intakeId: intake.id, status: 'FORWARDED', sha256: upload.sha256 })
        if (forwarded) {
          await sessions.update(upload.id, { status: 'FORWARDED', intakeId: intake.id, forwardedUploadId: forwarded.forwardedUploadId })
          return
        }
      }
      // Identical retransmissions never reopen an already reviewed study.
      const published = await manager.getRepository(DicomInstanceEntity).findOneBy({ companyId: upload.companyId, unitId: upload.unitId, instanceUid: metadata.tags.instanceUid })
      if (published && intake?.examId) {
        const object = await manager.getRepository(StoredObjectEntity).findOneByOrFail({ id: published.objectId })
        if (object.sha256 !== upload.sha256) throw new ConflictException('Instância já enviada com bytes diferentes.')
        await sessions.update(upload.id, { status: 'PUBLISHED', intakeId: intake.id, examId: intake.examId, resultId: published.id })
        return
      }
      if (!intake) {
        const { externalPatientId: _external, ...fields } = metadata.dto
        void _external
        // An invalid/missing DICOM time must be reviewed rather than fabricated.
        if (metadata.issues.some(issue => /Horário|Fuso|Data do estudo/.test(issue))) delete fields.performedAt
        intake = repository.create({ companyId: upload.companyId, unitId: upload.unitId,
          studyUid: metadata.tags.studyUid, identityHash: metadata.identityHash, fields, issues: metadata.issues })
      }
      if (!intake.examId) {
        for (const key of dicomStudyDetailFields) {
          if (!Object.hasOwn(intake.fields, key) && metadata.dto[key] !== undefined) {
            intake.fields = { ...intake.fields, [key]: metadata.dto[key] }
          }
        }
      }
      intake.status = 'DRAFT'
      intake.version = (intake.version ?? 0) + 1
      intake = await repository.save(intake)
      await sessions.update(upload.id, { status: 'AWAITING_REVIEW', intakeId: intake.id, validationReason: null })
    })
  }
}
