import { ConflictException, Injectable } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import { DicomStudyEntity } from '../../database/entities/dicom-study.entity'
import { DicomSeriesEntity } from '../../database/entities/dicom-series.entity'
import { DicomInstanceEntity } from '../../database/entities/dicom-instance.entity'
import { StoredObjectEntity } from '../../database/entities/stored-object.entity'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { DicomUploadMetadata } from './dicom-ingestion.service'
@Injectable()
export class DicomInstanceRegistrationService {
  constructor(private readonly audit: OperationalAuditService) {}
  async persist(
    upload: UploadSessionEntity,
    metadata: DicomUploadMetadata,
    study: DicomStudyEntity,
    manager: EntityManager,
  ) {
    const tags = metadata.tags
    let series = await manager.getRepository(DicomSeriesEntity).findOneBy({
      companyId: upload.companyId,
      unitId: upload.unitId,
      seriesUid: tags.seriesUid,
    })
    if (series && series.studyId !== study.id)
      throw new ConflictException('SeriesInstanceUID pertence a outro estudo.')
    series ??= await manager.getRepository(DicomSeriesEntity).save({
      companyId: upload.companyId,
      unitId: upload.unitId,
      studyId: study.id,
      seriesUid: tags.seriesUid,
      modality: tags.modality,
    })
    const object = await manager.getRepository(StoredObjectEntity).save({
      id: upload.id,
      companyId: upload.companyId,
      examId: study.examId,
      storageKey: upload.storageKey,
      originalName: upload.name,
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
      sha256: upload.sha256,
      status: 'STORED',
      createdByUserId: upload.context.userId,
    })
    const instance = await manager.getRepository(DicomInstanceEntity).save({
      companyId: upload.companyId,
      unitId: upload.unitId,
      studyId: study.id,
      seriesId: series.id,
      instanceUid: tags.instanceUid,
      objectId: object.id,
      orthancId: upload.previewOrthancId ?? null,
    })
    await manager
      .getRepository(DicomStudyEntity)
      .update(study.id, { lastReceivedAt: new Date(), completedAt: null, completionReason: null })
    await manager.getRepository(UploadSessionEntity).update(upload.id, {
      status: 'PUBLISHED',
      examId: study.examId,
      resultId: instance.id,
      validationReason: null,
    })
    await this.audit.record(
      upload.context,
      {
        action: 'DICOM_INSTANCE_RECEIVED',
        resourceType: 'exam',
        resourceId: study.examId,
        unitId: upload.unitId,
        metadata: { studyId: study.id, instanceId: instance.id, objectId: object.id },
      },
      manager,
    )
  }
}
