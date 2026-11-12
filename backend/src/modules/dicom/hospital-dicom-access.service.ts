import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { HospitalIntakeEntity } from '../../database/entities/hospital-intake.entity'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { DicomUploadMetadata } from './dicom-ingestion.service'
import { HospitalReceiptService } from './hospital-receipt.service'

@Injectable()
export class HospitalDicomAccessService {
  constructor(private readonly database: DataSource, private readonly companies: CompanyScopeService, private readonly receipt: HospitalReceiptService) {}
  async require(intakeId: string, context: CompanyAccessContext, uploadIds?: string[]) {
    if (!context.permissions.includes('hospital.intake.view')) throw new ForbiddenException()
    const intake = await this.database.getRepository(HospitalIntakeEntity).findOneBy({ id: intakeId, companyId: context.companyId })
    if (!intake) throw new NotFoundException('Estudo hospitalar não encontrado.')
    if (!(await this.companies.requireUnit(intake.unitId, context)).active) throw new NotFoundException('Unidade indisponível.')
    await this.receipt.assertReady(intake)
    const files = await this.database.getRepository(UploadSessionEntity).find({
      where: { intakeId, companyId: context.companyId, unitId: intake.unitId, kind: 'DICOM',
        status: In(['AWAITING_REVIEW', 'FORWARDED', 'PUBLISHED']), ...(uploadIds ? { id: In(uploadIds) } : {}) },
      order: { createdAt: 'ASC' },
    })
    if (!files.length || (uploadIds && files.length !== uploadIds.length)) throw new NotFoundException('Imagens validadas indisponíveis para este acesso.')
    const unique = new Map<string, UploadSessionEntity>()
    for (const file of files) {
      const metadata = file.payload.metadata as DicomUploadMetadata | undefined
      if (!metadata?.tags || metadata.tags.studyUid !== intake.studyUid) throw new ConflictException('Metadados do estudo exigem conferência.')
      const previous = unique.get(metadata.tags.instanceUid)
      if (previous && previous.sha256 !== file.sha256) throw new ConflictException('Uma instância contém arquivos divergentes. Confira a origem antes de visualizar.')
      unique.set(metadata.tags.instanceUid, previous ?? file)
    }
    return { intake, files: [...unique.values()] }
  }
  scope(intake: HospitalIntakeEntity, files: UploadSessionEntity[]) {
    const series = new Map<string, { id: string; seriesUid: string; studyId: string }>()
    const instances = files.map(file => {
      const { tags } = file.payload.metadata as DicomUploadMetadata
      series.set(tags.seriesUid, { id: tags.seriesUid, seriesUid: tags.seriesUid, studyId: intake.id })
      return { id: file.id, instanceUid: tags.instanceUid, seriesId: tags.seriesUid, studyId: intake.id }
    })
    return { studies: [{ id: intake.id, studyUid: intake.studyUid }], series: [...series.values()], instances }
  }
}
