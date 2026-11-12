import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
import type { DocumentPresentation } from '../../modules/companies/company-presentation'

@Entity({ name: 'company_settings_revisions' })
export class CompanySettingsRevisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null

  @Column({ type: 'integer' })
  version: number

  @Column({ type: 'jsonb', default: {} })
  presentation: Partial<DocumentPresentation>

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
