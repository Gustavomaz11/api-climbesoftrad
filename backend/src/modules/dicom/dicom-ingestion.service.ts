import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import { DicomStudyEntity } from '../../database/entities/dicom-study.entity'
import { DicomInstanceRegistrationService } from './dicom-instance-registration.service'
import { DicomInstanceEntity } from '../../database/entities/dicom-instance.entity'
import { StoredObjectEntity } from '../../database/entities/stored-object.entity'
import { DicomReviewEntity } from '../../database/entities/dicom-review.entity'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { ExamsService } from '../exams/exams.service'
import type { CreateExamDto } from '../exams/dto/create-exam.dto'
import { stableStudyIdentity, type DicomTags } from './dicom-metadata.policy'
export interface DicomUploadMetadata {
  tags: DicomTags
  dto: Partial<CreateExamDto>
  issues: string[]
  identityHash: string
}
@Injectable()
export class DicomIngestionService {
  constructor(
    private readonly database: DataSource,
    private readonly exams: ExamsService,
    private readonly instances: DicomInstanceRegistrationService,
  ) {}
  async ingest(upload: UploadSessionEntity, metadata: DicomUploadMetadata, transaction?: EntityManager) {
    const persist = async (manager: EntityManager) => {
      const tags = metadata.tags
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        stableStudyIdentity(upload.companyId, upload.unitId, tags.studyUid),
      ])
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify(['dicom-instance', upload.companyId, upload.unitId, tags.instanceUid]),
      ])
      const locked = await manager
        .getRepository(UploadSessionEntity)
        .findOneOrFail({ where: { id: upload.id }, lock: { mode: 'pessimistic_write' } })
      if (locked.status === 'PUBLISHED') return
      let study = await manager
        .getRepository(DicomStudyEntity)
        .findOneBy({ companyId: upload.companyId, unitId: upload.unitId, studyUid: tags.studyUid })
      if (study && study.identityHash !== metadata.identityHash)
        throw new ConflictException('Metadados divergentes sob o mesmo StudyInstanceUID.')
      const duplicate = await manager.getRepository(DicomInstanceEntity).findOneBy({
        companyId: upload.companyId,
        unitId: upload.unitId,
        instanceUid: tags.instanceUid,
      })
      if (duplicate) {
        const object = await manager
          .getRepository(StoredObjectEntity)
          .findOneByOrFail({ id: duplicate.objectId })
        if (!study || duplicate.studyId !== study.id || object.sha256 !== upload.sha256)
          throw new ConflictException(
            'SOPInstanceUID já recebido com conteúdo ou estudo diferente.',
          )
        await manager
          .getRepository(UploadSessionEntity)
          .update(upload.id, { status: 'PUBLISHED', examId: study.examId, resultId: duplicate.id })
        return
      }
      if (!study && metadata.issues.length && !upload.payload.correction) {
        await this.review(
          upload,
          'DEMOGRAPHICS',
          { issues: metadata.issues, received: metadata.dto },
          null,
          manager,
        )
        await manager.getRepository(UploadSessionEntity).update(upload.id, {
          status: 'QUARANTINED',
          validationReason: 'Metadados cadastrais exigem conferência.',
        })
        return
      }
      if (!study) {
        const dto = {
          ...metadata.dto,
          ...((upload.payload.correction as Partial<CreateExamDto>) ?? {}),
          unitId: upload.unitId,
          sourceExamId: tags.studyUid,
          originIssuer: `DICOM:${upload.unitId}:${tags.issuer || 'SEM_EMISSOR'}`,
        } as CreateExamDto
        // Without an issuer, PatientID is insufficient evidence for automatic association.
        if (!tags.issuer) delete dto.externalPatientId
        const exam = await this.exams.create(dto, upload.context, manager)
        study = await manager.getRepository(DicomStudyEntity).save({
          companyId: upload.companyId,
          unitId: upload.unitId,
          examId: exam.id,
          studyUid: tags.studyUid,
          identityHash: metadata.identityHash,
          lastReceivedAt: new Date(),
        })
        await this.possibleDuplicates(upload, exam.id, dto, manager)
      }
      await this.instances.persist(upload, metadata, study, manager)
    }
    return transaction ? persist(transaction) : this.database.transaction(persist)
  }
  async collision(upload: UploadSessionEntity, message: string) {
    await this.database.transaction(async (manager) => {
      await this.review(upload, 'IDENTITY_COLLISION', { reason: message }, null, manager)
      await manager
        .getRepository(UploadSessionEntity)
        .update(upload.id, { status: 'QUARANTINED', validationReason: message })
    })
  }
  private async possibleDuplicates(
    upload: UploadSessionEntity,
    examId: string,
    dto: CreateExamDto,
    manager: EntityManager,
  ) {
    const candidates = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM exams WHERE company_id=$1 AND unit_id=$2 AND id<>$3
      AND birth_date=$4 AND modality=$5 AND performed_at BETWEEN $6::timestamptz-interval '1 day' AND $6::timestamptz+interval '1 day'
      AND similarity(patient_name,$7)>0.65 LIMIT 10`,
      [
        upload.companyId,
        upload.unitId,
        examId,
        dto.birthDate,
        dto.modality,
        dto.performedAt,
        dto.patientName,
      ],
    )
    if (candidates.length)
      await this.review(
        upload,
        'POSSIBLE_DUPLICATE',
        { candidateExamIds: candidates.map((x) => x.id) },
        examId,
        manager,
      )
  }
  private async review(
    upload: UploadSessionEntity,
    kind: DicomReviewEntity['kind'],
    details: Record<string, unknown>,
    examId: string | null,
    manager: EntityManager,
  ) {
    const existing = await manager
      .getRepository(DicomReviewEntity)
      .findOneBy({ uploadId: upload.id, kind })
    if (existing) return existing
    return manager.getRepository(DicomReviewEntity).save({
      companyId: upload.companyId,
      unitId: upload.unitId,
      uploadId: upload.id,
      examId,
      kind,
      details,
    })
  }
}
