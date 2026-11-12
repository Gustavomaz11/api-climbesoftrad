import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'stored_objects' })
export class StoredObjectEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'company_id', type: 'uuid' }) companyId: string
  @Column({ name: 'exam_id', type: 'uuid', nullable: true }) examId: string | null
  @Column({ name: 'storage_key', type: 'varchar', length: 500 }) storageKey: string
  @Column({ name: 'original_name', type: 'varchar', length: 255 }) originalName: string
  @Column({ name: 'content_type', type: 'varchar', length: 120 }) contentType: string
  @Column({ name: 'size_bytes', type: 'integer' }) sizeBytes: number
  @Column({ type: 'varchar', length: 64 }) sha256: string
  @Column({ type: 'varchar', length: 20 }) status: 'REGISTERED' | 'STORED' | 'UNREFERENCED'
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId: string
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
}
