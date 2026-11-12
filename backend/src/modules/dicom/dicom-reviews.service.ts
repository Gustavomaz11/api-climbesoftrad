import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { DicomReviewEntity } from '../../database/entities/dicom-review.entity'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { ResolveDicomReviewDto } from './dicom-review.dto'
@Injectable()
export class DicomReviewsService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: CompanyScopeService,
    private readonly audit: OperationalAuditService,
  ) {}
  async list(context: CompanyAccessContext) {
    return this.database.getRepository(DicomReviewEntity).find({
      where: {
        companyId: context.companyId,
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      order: { createdAt: 'DESC' },
      take: 100,
    })
  }
  async resolve(id: string, dto: ResolveDicomReviewDto, context: CompanyAccessContext) {
    return this.database.transaction(async (manager) => {
      const review = await manager.getRepository(DicomReviewEntity).findOne({
        where: { id, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!review) throw new NotFoundException('Conferência não encontrada.')
      await this.scope.requireUnit(review.unitId, context)
      if (review.status !== 'OPEN' || review.version !== dto.expectedVersion)
        throw new ConflictException('Conferência já decidida.')
      if (review.kind === 'DEMOGRAPHICS' && dto.action !== 'CORRECT')
        throw new BadRequestException('Corrija o cadastro completo para encerrar esta conferência.')
      if (dto.action === 'CORRECT') {
        if (review.kind !== 'DEMOGRAPHICS' || !dto.exam || dto.exam.unitId !== review.unitId)
          throw new BadRequestException('A correção exige cadastro completo na unidade original.')
        if (
          dto.exam.sourceExamId ||
          dto.exam.originIssuer ||
          dto.exam.externalPatientId ||
          dto.exam.patientId ||
          dto.exam.examTypeId ||
          dto.exam.externalEncounterId
        )
          throw new BadRequestException(
            'Identificadores recebidos não podem ser alterados nesta conferência.',
          )
        const upload = await manager
          .getRepository(UploadSessionEntity)
          .findOneByOrFail({ id: review.uploadId })
        upload.payload = { ...upload.payload, correction: dto.exam }
        upload.context = context
        upload.status = 'APPROVED'
        upload.validationReason = null
        await manager.save(upload)
      }
      review.status = 'RESOLVED'
      review.version++
      review.resolvedByUserId = context.userId
      review.resolutionReason = dto.reason
      await manager.save(review)
      await this.audit.record(
        context,
        {
          action: 'DICOM_REVIEW_DECIDED',
          resourceType: 'dicom-review',
          resourceId: id,
          unitId: review.unitId,
          reason: dto.reason,
          metadata: { action: dto.action, kind: review.kind },
        },
        manager,
      )
      return { id, status: review.status }
    })
  }
}
