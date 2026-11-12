import {
  ConflictException,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { DicomInstanceEntity } from '../../database/entities/dicom-instance.entity'
import { StoredObjectEntity } from '../../database/entities/stored-object.entity'
import { UploadValidationWorker } from '../document-uploads/upload-validation-worker.service'
import { UploadLiveContextService } from '../document-uploads/upload-live-context.service'
import { R2MultipartStorage } from '../file-validation/r2-multipart-storage.service'
import { DicomIngestionService, type DicomUploadMetadata } from './dicom-ingestion.service'
import { OrthancArchiveService } from './orthanc-archive.service'
import { HospitalIntakeStagingService } from './hospital-intake-staging.service'
@Injectable()
export class ImageIngestionWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined
  private busy = false
  private readonly logger = new Logger(ImageIngestionWorker.name)
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly validation: UploadValidationWorker,
    private readonly live: UploadLiveContextService,
    private readonly ingestion: DicomIngestionService,
    private readonly archive: OrthancArchiveService,
    private readonly storage: R2MultipartStorage,
    private readonly hospital: HospitalIntakeStagingService,
  ) {}
  onModuleInit() {
    if (this.config.get<string>('NODE_ENV') !== 'test')
      this.timer = setInterval(() => {
        void this.runBatch().catch(() =>
          this.logger.error('Falha no processamento da fila de arquivos.'),
        )
      }, 1000)
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }
  async runBatch() {
    if (this.busy) return
    this.busy = true
    try {
      await this.validation.runBatch()
      const uploads = await this.database.getRepository(UploadSessionEntity).find({
        where: { kind: 'DICOM', status: 'APPROVED' },
        order: { createdAt: 'ASC' },
        take: 10,
      })
      for (const upload of uploads) {
        try {
          upload.context = await this.live.resolve(upload)
          if (upload.payload.hospitalIntake === true)
            await this.hospital.stage(upload, upload.payload.metadata as DicomUploadMetadata)
          else await this.ingestion.ingest(upload, upload.payload.metadata as DicomUploadMetadata)
        } catch (error) {
          if (error instanceof ConflictException)
            await this.ingestion.collision(upload, error.message)
          else
            await this.database.getRepository(UploadSessionEntity).update(upload.id, {
              status: 'QUARANTINED',
              validationReason:
                'Ingestão indisponível ou origem sem autorização. Reprocessamento necessário.',
            })
        }
      }
      await this.archivePending()
    } finally {
      this.busy = false
    }
  }
  private async archivePending() {
    if (!this.archive.configured) return
    const instances = await this.database
      .getRepository(DicomInstanceEntity)
      .createQueryBuilder('i')
      .where(
        'i.orthanc_id IS NULL AND i.archive_attempts<8 AND (i.archive_retry_at IS NULL OR i.archive_retry_at<=now())',
      )
      .orderBy('i.created_at', 'ASC')
      .take(10)
      .getMany()
    for (const instance of instances) {
      const object = await this.database
        .getRepository(StoredObjectEntity)
        .findOneByOrFail({ id: instance.objectId })
      try {
        const orthancId = await this.archive.store(
          await this.storage.stream(object.storageKey),
          object.sha256,
        )
        await this.database
          .getRepository(DicomInstanceEntity)
          .update(instance.id, { orthancId, archiveError: null })
      } catch {
        await this.database
          .getRepository(DicomInstanceEntity)
          .update(instance.id, {
            archiveError: 'ARCHIVE_UNAVAILABLE',
            archiveAttempts: instance.archiveAttempts + 1,
            archiveRetryAt: new Date(
              Date.now() + Math.min(1800000, 5000 * 2 ** instance.archiveAttempts),
            ),
          })
      }
    }
  }
}
