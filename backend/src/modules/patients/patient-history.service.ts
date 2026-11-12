import { Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { ExamEntity } from '../../database/entities/exam.entity'
import { documentAvailability } from './patient-document-availability'
import { PatientScopeService } from './patient-scope.service'
import { ExamAccessService } from '../exams/exam-access.service'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { ExamAttachmentReaderService } from '../exam-attachments/exam-attachment-reader.service'
import { DicomStudyEntity } from '../../database/entities/dicom-study.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
@Injectable()
export class PatientHistoryService {
  constructor(
    private readonly database: DataSource,
    private readonly patients: PatientScopeService,
    private readonly exams: ExamAccessService,
    private readonly objects: R2ObjectStorage,
    private readonly attachments: ExamAttachmentReaderService,
  ) {}
  async list(patientId: string, context: CompanyAccessContext) {
    await this.patients.require(patientId, context)
    const exams = await this.database.getRepository(ExamEntity).find({
      where: {
        patientId,
        companyId: context.companyId,
        ...(context.allUnits ? {} : { unitId: In(context.unitIds) }),
      },
      relations: { unit: true },
      order: { performedAt: 'DESC' },
    })
    return exams.map((exam) => this.summary(exam))
  }
  async forExam(examId: string, context: CompanyAccessContext) {
    const exam = await this.exams.require(examId, context)
    const patient = await this.patients.require(exam.patientId, context)
    return {
      patientId: exam.patientId,
      patient: {
        id: patient.id,
        fullName: patient.fullName,
        birthDate: patient.birthDate,
        revision: patient.revision,
      },
      current: this.summary(exam),
      items: await this.list(exam.patientId, context),
    }
  }
  async availability(patientId: string, examId: string, context: CompanyAccessContext) {
    await this.patients.require(patientId, context)
    const exam = await this.exams.require(examId, context)
    if (exam.patientId !== patientId)
      throw new NotFoundException('Exame não encontrado neste paciente.')
    const [report, prescription, attachments] = await Promise.all([
      context.permissions.includes('reports.view')
        ? this.objects.readText('reports/' + examId + '/report.json')
        : Promise.resolve(undefined),
      context.permissions.includes('prescriptions.view')
        ? this.objects.readText('prescriptions/' + examId + '/prescription.json')
        : Promise.resolve(undefined),
      this.attachments.availability(examId, context),
    ])
    return {
      report: documentAvailability(report, examId),
      prescription: documentAvailability(prescription, examId, true),
      images: context.permissions.includes('exams.viewer.open')
        ? await this.database.getRepository(DicomStudyEntity).existsBy({examId,companyId:context.companyId}) ? 'AVAILABLE' : 'UNAVAILABLE'
        : 'NOT_AUTHORIZED',
      publishedReport: 'NOT_IMPLEMENTED',
      attachments: attachments.status,
      attachmentCount: attachments.count,
    }
  }
  summary(exam: ExamEntity) {
    return {
      id: exam.id,
      patientId: exam.patientId,
      patientName: exam.patientName,
      birthDate: exam.birthDate,
      unitId: exam.unitId,
      unit: exam.unit?.name ?? '',
      modality: exam.modality,
      studyDescription: exam.studyDescription,
      performedAt: exam.performedAt,
      examTypeId: exam.examTypeId,
      patientIdentityStatus: exam.patientIdentityStatus,
      normalizationStatus: exam.normalizationStatus,
    }
  }
}
