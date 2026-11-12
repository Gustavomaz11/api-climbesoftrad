import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { randomBytes } from 'node:crypto'
import archiver from 'archiver'
import type { Response } from 'express'
import { DicomViewerGrantEntity } from '../../database/entities/dicom-viewer-grant.entity'
import { DicomStudyEntity } from '../../database/entities/dicom-study.entity'
import { DicomSeriesEntity } from '../../database/entities/dicom-series.entity'
import { DicomInstanceEntity } from '../../database/entities/dicom-instance.entity'
import { StoredObjectEntity } from '../../database/entities/stored-object.entity'
import { ExamAccessService } from '../exams/exam-access.service'
import { UploadLiveContextService } from '../document-uploads/upload-live-context.service'
import { R2MultipartStorage } from '../file-validation/r2-multipart-storage.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { dicomTokenHash } from './dicom-sources.service'
import { DicomViewerGrantsService } from './dicom-viewer-grants.service'
@Injectable()
export class DicomDownloadService {
  constructor(
    private readonly database: DataSource,
    private readonly access: ExamAccessService,
    private readonly live: UploadLiveContextService,
    private readonly storage: R2MultipartStorage,
    private readonly audit: OperationalAuditService,
    private readonly grants: DicomViewerGrantsService,
  ) {}
  async ticket(examId: string, context: CompanyAccessContext) {
    const exam = await this.access.require(examId, context)
    const studies = await this.database
      .getRepository(DicomStudyEntity)
      .findBy({ examId, companyId: context.companyId })
    if (!studies.length) throw new NotFoundException('Sem imagens para baixar.')
    const token = randomBytes(32).toString('base64url')
    await this.database.transaction(async (manager) => {
      await manager.getRepository(DicomViewerGrantEntity).save({
        tokenHash: dicomTokenHash(token),
        context,
        studyIds: studies.map((x) => x.id),
        expiresAt: new Date(Date.now() + 5 * 60000),
      })
      await this.audit.record(
        context,
        {
          action: 'DICOM_DOWNLOAD_REQUESTED',
          resourceType: 'exam',
          resourceId: examId,
          unitId: exam.unitId,
        },
        manager,
      )
    })
    return { url: `${this.grants.publicRoot}/dicom-download/${token}`, expiresIn: 300 }
  }
  async deliver(token: string, response: Response) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException()
    const grant = await this.database
      .getRepository(DicomViewerGrantEntity)
      .findOneBy({ tokenHash: dicomTokenHash(token) })
    if (!grant || grant.expiresAt <= new Date())
      throw new UnauthorizedException('Download expirou. Solicite novamente.')
    if (grant.intakeId) throw new ForbiddenException('Este acesso permite somente visualizar o estudo hospitalar.')
    const context = await this.live.user(grant.context)
    if (
      !context.permissions.includes('attachments.view') ||
      !context.permissions.includes('exams.view')
    )
      throw new ForbiddenException()
    const studies = await this.database
      .getRepository(DicomStudyEntity)
      .findBy({ id: In(grant.studyIds), companyId: context.companyId })
    for (const study of studies) await this.access.require(study.examId, context)
    const series = await this.database
      .getRepository(DicomSeriesEntity)
      .findBy({ studyId: In(studies.map((x) => x.id)) })
    const instances = await this.database
      .getRepository(DicomInstanceEntity)
      .findBy({ studyId: In(studies.map((x) => x.id)) })
    const objects = await this.database
      .getRepository(StoredObjectEntity)
      .findBy({ id: In(instances.map((x) => x.objectId)), status: 'STORED' })
    if (objects.length !== instances.length)
      throw new NotFoundException('Arquivos requerem recuperação.')
    response.setHeader('Content-Type', 'application/zip')
    response.setHeader('Content-Disposition', 'attachment; filename="estudo-dicom.zip"')
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    const zip = archiver('zip', { store: true }),
      streams: Array<Awaited<ReturnType<R2MultipartStorage['stream']>>> = []
    zip.on('error', () => response.destroy())
    response.on('close', () => {
      zip.abort()
      for (const stream of streams) stream.destroy()
    })
    const delivered = new Promise<boolean>((resolve) => {
      response.once('finish', () => resolve(true))
      response.once('close', () => resolve(response.writableFinished))
    })
    zip.pipe(response)
    const manifest = []
    for (const instance of instances) {
      const object = objects.find((x) => x.id === instance.objectId)!,
        study = studies.find((x) => x.id === instance.studyId)!,
        item = series.find((x) => x.id === instance.seriesId)!
      const path = `${study.studyUid}/${item.seriesUid}/${instance.instanceUid}.dcm`
      const stream = await this.storage.stream(object.storageKey)
      streams.push(stream)
      zip.append(stream, { name: path })
      manifest.push({
        studyUid: study.studyUid,
        seriesUid: item.seriesUid,
        instanceUid: instance.instanceUid,
        path,
        sha256: object.sha256,
        sizeBytes: object.sizeBytes,
      })
    }
    zip.append(JSON.stringify({ version: 1, instances: manifest }, null, 2), {
      name: 'manifest.json',
    })
    await zip.finalize()
    if (!(await delivered)) return
    await this.audit.record(context, {
      action: 'DICOM_DOWNLOAD_DELIVERED',
      resourceType: 'exam',
      resourceId: studies[0]!.examId,
      unitId: studies[0]!.unitId,
      metadata: { instanceCount: instances.length },
    })
  }
}
