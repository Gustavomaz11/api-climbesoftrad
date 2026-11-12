import { Injectable } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import type { ExamEntity } from '../../database/entities/exam.entity'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { preparationItems, type ChecklistEvidence } from './workflow.contracts'

interface FileEvidence {
  id: string
  category: string
  storage_key: string
  size_bytes: number
  sha256: string
}

@Injectable()
export class PreparationEvidenceService {
  constructor(private readonly objects: R2ObjectStorage) {}
  private async stored(file: FileEvidence) {
    try {
      const actual = await this.objects.stat(file.storage_key)
      return Boolean(
        actual && actual.sizeBytes === file.size_bytes && actual.sha256 === file.sha256,
      )
    } catch {
      return false
    }
  }
  async collect(exam: ExamEntity, manager: EntityManager): Promise<ChecklistEvidence[]> {
    const files = await manager.query<FileEvidence[]>(
      `SELECT a.id,a.category,o.storage_key,o.size_bytes,o.sha256
      FROM exam_attachments a JOIN stored_objects o ON o.id=a.object_id AND o.company_id=a.company_id
      WHERE a.exam_id=$1 AND a.company_id=$2 AND a.superseded_at IS NULL AND a.validation_status='APPROVED' AND o.status='STORED'`,
      [exam.id, exam.companyId],
    )
    const accepted: FileEvidence[] = []
    for (const file of files) if (await this.stored(file)) accepted.push(file)
    const studies = await manager.query<
      Array<{ id: string; completed_at: Date | null; instances: number; stored: number }>
    >(
      `SELECT s.id,s.completed_at,COUNT(i.id)::int AS instances,
      COUNT(i.id) FILTER(WHERE o.status='STORED')::int AS stored
      FROM dicom_studies s LEFT JOIN dicom_instances i ON i.study_id=s.id
      LEFT JOIN stored_objects o ON o.id=i.object_id AND o.company_id=s.company_id
      WHERE s.exam_id=$1 AND s.company_id=$2 GROUP BY s.id ORDER BY s.id`,
      [exam.id, exam.companyId],
    )
    const comparative = await manager.query<Array<{ id: string }>>(
      `SELECT c.id FROM exam_comparatives c JOIN exams prior ON prior.id=c.comparative_exam_id
      WHERE c.exam_id=$1 AND c.company_id=$2 AND c.active AND c.linked_patient_id=$3 AND prior.patient_id=$3
      AND (EXISTS(SELECT 1 FROM dicom_studies s JOIN dicom_instances i ON i.study_id=s.id JOIN stored_objects o ON o.id=i.object_id
        WHERE s.exam_id=prior.id AND s.completed_at IS NOT NULL AND o.status='STORED')
        OR EXISTS(SELECT 1 FROM exam_attachments a JOIN stored_objects o ON o.id=a.object_id
          WHERE a.exam_id=prior.id AND a.superseded_at IS NULL AND a.validation_status='APPROVED' AND o.status='STORED'))`,
      [exam.id, exam.companyId, exam.patientId],
    )
    return preparationItems.map((item) => {
      const evidenceIds =
        item === 'IMAGES'
          ? studies.map((s) => s.id)
          : item === 'COMPARATIVE'
            ? [
                ...accepted.filter((f) => f.category === item).map((f) => f.id),
                ...comparative.map((c) => c.id),
              ]
            : accepted.filter((f) => f.category === item).map((f) => f.id)
      const available =
        item === 'IMAGES'
          ? studies.length > 0 &&
            studies.every((s) => s.completed_at && s.instances > 0 && s.instances === s.stored)
          : evidenceIds.length > 0
      return { item, evidenceIds, available, confirmed: false, exceptionReason: null }
    })
  }
}
