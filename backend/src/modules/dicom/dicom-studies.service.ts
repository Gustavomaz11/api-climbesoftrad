import { BadRequestException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { DicomStudyEntity } from '../../database/entities/dicom-study.entity'
import { ExamAccessService } from '../exams/exam-access.service'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
@Injectable()
export class DicomStudiesService {
  constructor(
    private readonly database: DataSource,
    private readonly access: ExamAccessService,
    private readonly audit: OperationalAuditService,
  ) {}
  async forExam(examId: string, context: CompanyAccessContext) {
    await this.access.require(examId, context)
    const studies = await this.database
      .getRepository(DicomStudyEntity)
      .findBy({ examId, companyId: context.companyId })
    const items = []
    for (const study of studies) {
      const [counts] = await this.database.query<
        Array<{ series: number; instances: number; archived: number; failed: number }>
      >(
        `SELECT COUNT(DISTINCT series_id)::int AS series,COUNT(*)::int AS instances,
        COUNT(orthanc_id)::int AS archived,COUNT(archive_error)::int AS failed FROM dicom_instances WHERE study_id=$1`,
        [study.id],
      )
      items.push({
        ...study,
        ...counts,
        status: study.completedAt ? 'RECEIVED' : 'RECEIVING',
        clinicalCompleteness: 'NOT_ATTESTED',
      })
    }
    return {
      status: items.length
        ? items.every((x) => x.status === 'RECEIVED')
          ? 'RECEIVED'
          : 'RECEIVING'
        : 'NO_IMAGES',
      items,
    }
  }
  async comparison(examId: string, previousId: string, context: CompanyAccessContext) {
    const current = await this.access.require(examId, context),
      previous = await this.access.require(previousId, context)
    if (
      current.id === previous.id ||
      current.patientId !== previous.patientId ||
      previous.performedAt > current.performedAt
    )
      throw new BadRequestException('Selecione exame anterior do mesmo paciente.')
    return {
      current: await this.forExam(examId, context),
      previous: await this.forExam(previousId, context),
    }
  }
  async complete(examId: string, reason: string, context: CompanyAccessContext) {
    const exam = await this.access.require(examId, context)
    return this.database.transaction(async (manager) => {
      const studies = await manager.getRepository(DicomStudyEntity).find({
        where: { examId, companyId: context.companyId },
        lock: { mode: 'pessimistic_write' },
      })
      for (const study of studies) {
        study.completedAt = new Date()
        study.completionReason = reason
        await manager.save(study)
        await this.audit.record(
          context,
          {
            action: 'DICOM_STUDY_COMPLETED',
            resourceType: 'exam',
            resourceId: examId,
            unitId: exam.unitId,
            reason,
            metadata: { studyId: study.id },
          },
          manager,
        )
      }
      return { status: studies.length ? 'RECEIVED' : 'NO_IMAGES' }
    })
  }
  async retryArchive(examId: string, context: CompanyAccessContext) {
    await this.access.require(examId, context)
    await this.database.query(
      `UPDATE dicom_instances SET archive_attempts=0,archive_retry_at=NULL,archive_error=NULL WHERE orthanc_id IS NULL AND study_id IN (SELECT id FROM dicom_studies WHERE exam_id=$1 AND company_id=$2)`,
      [examId, context.companyId],
    )
    return { status: 'QUEUED' }
  }
}
