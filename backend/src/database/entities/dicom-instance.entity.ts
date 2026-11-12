import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
@Entity({ name: 'dicom_instances' })
export class DicomInstanceEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid' }) unitId: string
  @Column({ name: 'study_id', type: 'uuid' }) studyId: string
  @Column({ name: 'series_id', type: 'uuid' }) seriesId: string
  @Column({ name: 'instance_uid', type: 'varchar', length: 64 }) instanceUid: string
  @Column({ name: 'object_id', type: 'uuid' }) objectId: string
  @Column({ name: 'orthanc_id', type: 'varchar', length: 64, nullable: true }) orthancId:
    string | null
  @Column({ name: 'archive_error', type: 'varchar', length: 100, nullable: true }) archiveError:
    string | null
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
  @Column({ name: 'archive_attempts', type: 'integer', default: 0 }) archiveAttempts: number
  @Column({ name: 'archive_retry_at', type: 'timestamptz', nullable: true })
  archiveRetryAt: Date | null
}
