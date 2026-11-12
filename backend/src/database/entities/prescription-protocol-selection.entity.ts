import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
export interface PrescriptionProtocolSnapshot {
  protocolId: string
  protocolVersion: number
  name: string
  examTypeId: string
  modality: string
  template: string
  fields: Array<{
    key: string
    label: string
    kind: 'TEXT' | 'NUMBER'
    unit: string
    required: boolean
  }>
  values: Record<string, string>
  observations: string
  notes: string
  renderedText: string
}
@Entity({ name: 'prescription_protocol_selections' })
export class PrescriptionProtocolSelectionEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'exam_id', type: 'uuid' }) examId: string
  @Column({ name: 'protocol_id', type: 'uuid' }) protocolId: string
  @Column({ type: 'jsonb' }) snapshot: PrescriptionProtocolSnapshot
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId: string
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
}
