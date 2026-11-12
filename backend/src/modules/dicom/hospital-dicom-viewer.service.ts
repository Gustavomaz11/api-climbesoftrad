import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'node:crypto'
import { DataSource } from 'typeorm'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { DicomViewerGrantEntity } from '../../database/entities/dicom-viewer-grant.entity'
import { UploadLiveContextService } from '../document-uploads/upload-live-context.service'
import { R2MultipartStorage } from '../file-validation/r2-multipart-storage.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { HospitalDicomAccessService } from './hospital-dicom-access.service'
import { OrthancArchiveService } from './orthanc-archive.service'
import { dicomTokenHash } from './dicom-sources.service'
import { dicomViewerUrl } from './dicom-viewer-url'

@Injectable()
export class HospitalDicomViewerService {
  constructor(private readonly database: DataSource, private readonly config: ConfigService,
    private readonly access: HospitalDicomAccessService, private readonly live: UploadLiveContextService,
    private readonly storage: R2MultipartStorage, private readonly archive: OrthancArchiveService,
    private readonly audit: OperationalAuditService) {}
  async create(intakeId: string, context: CompanyAccessContext) {
    const viewer = this.config.get<string>('OHIF_VIEWER_URL')
    if (!viewer || !this.archive.configured) throw new ServiceUnavailableException('Visualizador DICOM não configurado.')
    const { files } = await this.access.require(intakeId, context)
    for (const file of files) {
      if (file.previewOrthancId) continue
      const orthancId = await this.archive.store(await this.storage.stream(file.storageKey), file.sha256)
      await this.database.getRepository(UploadSessionEntity).update(file.id, { previewOrthancId: orthancId })
    }
    // A long first preparation must not issue access after the operator's membership was revoked.
    const current = await this.live.user(context)
    const snapshot = await this.access.require(intakeId, current, files.map(file => file.id))
    const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 15 * 60000)
    await this.database.transaction(async manager => {
      await manager.getRepository(DicomViewerGrantEntity).save({ tokenHash: dicomTokenHash(token), context: current,
        studyIds: [], intakeId, uploadIds: snapshot.files.map(file => file.id), expiresAt })
      await this.audit.record(current, { action: 'HOSPITAL_DICOM_VIEWER_OPENED', resourceType: 'hospital-intake',
        resourceId: intakeId, unitId: snapshot.intake.unitId, metadata: { instances: snapshot.files.length } }, manager)
    })
    const root = this.config.get<string>('PUBLIC_API_URL') || 'http://localhost:3000/api/v1'
    return { url: dicomViewerUrl(viewer, root, token, [snapshot.intake.studyUid]), expiresAt, instanceCount: snapshot.files.length }
  }
}
