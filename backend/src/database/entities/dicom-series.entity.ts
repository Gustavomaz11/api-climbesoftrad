import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'
@Entity({ name: 'dicom_series' })
export class DicomSeriesEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'unit_id', type: 'uuid' }) unitId: string
  @Column({ name: 'study_id', type: 'uuid' }) studyId: string
  @Column({ name: 'series_uid', type: 'varchar', length: 64 }) seriesUid: string
  @Column({ type: 'varchar', length: 10 }) modality: string
}
