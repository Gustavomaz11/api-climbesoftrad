import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { AuthUserEntity } from './auth-user.entity'
import { MedicalSpecialtyEntity } from './medical-specialty.entity'
import type { PhysicianRegistryProfile } from '../../modules/physicians/physician-registry.policy'
import type { PhysicianSignatureImage } from '../../modules/physicians/physician-signature.contract'

@Entity({ name: 'physicians' })
export class PhysicianEntity {
  @Column({ name: 'signature_image', type: 'jsonb', nullable: true, select: false })
  signatureImage: PhysicianSignatureImage | null

  @Column({ name: 'contact_phone', type: 'varchar', length: 30, nullable: true })
  contactPhone: string | null

  @Column({ name: 'registry_profile', type: 'jsonb', nullable: true })
  registryProfile: PhysicianRegistryProfile | null
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string

  @Column({ type: 'citext', unique: true })
  crm: string

  @Column({ type: 'varchar', length: 120 })
  name: string

  @Column({ name: 'specialty_id', type: 'uuid' })
  specialtyId: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date

  @OneToOne(() => AuthUserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AuthUserEntity

  @ManyToOne(() => MedicalSpecialtyEntity, (specialty) => specialty.physicians, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'specialty_id' })
  specialty: MedicalSpecialtyEntity
}
