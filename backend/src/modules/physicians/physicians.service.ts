import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { MedicalSpecialtyEntity } from '../../database/entities/medical-specialty.entity'
import { PhysicianEntity } from '../../database/entities/physician.entity'
import { AccessRoleEntity } from '../../database/entities/access-role.entity'
import { CompanyMembershipEntity } from '../../database/entities/company-membership.entity'
import { CryptoService } from '../auth/crypto.service'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { CompanyMembershipReader } from '../companies/company-membership-reader'
import { CompanyMembershipService } from '../companies/company-membership.service'
import {
  requireMembershipRole,
  saveMembershipUnits,
  validateMembershipUnits,
} from '../companies/company-membership-grants'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { CreatePhysicianDto } from './dto/create-physician.dto'
import { PhysicianRegistryService } from './physician-registry.service'
import { physicianInitialPassword } from './physician-initial-password'
import { PhysicianAccessEmails } from './physician-access-emails.service'

@Injectable()
export class PhysiciansService {
  constructor(
    private readonly database: DataSource,
    private readonly crypto: CryptoService,
    private readonly reader: CompanyMembershipReader,
    private readonly memberships: CompanyMembershipService,
    private readonly audit: OperationalAuditService,
    private readonly registry: PhysicianRegistryService,
    private readonly accessEmails: PhysicianAccessEmails,
  ) {}

  async list(context: CompanyAccessContext) {
    const memberships = await this.reader
      .query(context)
      .innerJoin(PhysicianEntity, 'physician', 'physician.user_id = membership.user_id')
      .getMany()
    if (!memberships.length) return []
    const physicians = await this.database.getRepository(PhysicianEntity).find({
      where: { userId: In(memberships.map((membership) => membership.userId)) },
      relations: { specialty: true },
      order: { name: 'ASC' },
    })
    const invitations = await this.accessEmails.summaries(memberships.map(item => item.id))
    return physicians.map((physician) => {
      const membership = memberships.find(item => item.userId === physician.userId)!
      return { ...this.response(
        physician,
        membership,
        context,
      ), accessEmail: invitations.get(membership.id) ?? null }
    })
  }

  async create(dto: CreatePhysicianDto, context: CompanyAccessContext) {
    const crm = dto.crm.trim().replace(/\s+/g, ' ').toUpperCase()
    const initialPassword = physicianInitialPassword(crm)
    const passwordHash = await this.crypto.hashPassword(initialPassword)
    try {
      const result = await this.database.transaction(async (manager) => {
        const profile = dto.registryLookupId ? await this.registry.consume(dto.registryLookupId, context, manager) : null
        if (profile && crm !== `${profile.registrations[0]!.crm}/${profile.registrations[0]!.uf}`)
          throw new BadRequestException('O CRM deve corresponder à consulta realizada.')
        const role = await manager.getRepository(AccessRoleEntity).findOneByOrFail({
          companyId: context.companyId,
          code: 'DOCTOR',
          active: true,
        })
        await requireMembershipRole(manager, role.id, context)
        const unitIds = await validateMembershipUnits(manager, dto, context)
        if (!dto.allUnits && !unitIds.length) throw new BadRequestException('Selecione ao menos uma unidade para o médico.')
        const specialties = manager.getRepository(MedicalSpecialtyEntity)
        const specialty = await specialties.findOneBy({ id: dto.specialtyId ?? '00000000-0000-4000-8000-000000000099', active: true })
        if (!specialty) throw new BadRequestException('Especialidade inválida ou inativa.')
        const physicians = manager.getRepository(PhysicianEntity)
        const identities = profile ? await manager.query<Array<{ physician_id: string }>>(`SELECT DISTINCT physician_id FROM physician_crm_registrations r
          JOIN jsonb_to_recordset($1::jsonb) AS lookup(crm text,uf text) ON r.crm=lookup.crm AND r.uf=lookup.uf`, [JSON.stringify(profile.registrations)]) : []
        if (identities.length > 1) throw new ConflictException('As inscrições pertencem a cadastros diferentes. Revise os cadastros existentes.')
        let physician = await physicians.findOne({
          where: identities[0] ? { id: identities[0].physician_id } : { crm },
          relations: { user: true, specialty: true },
        })
        const existingIdentity = Boolean(physician)
        if (physician) {
          if (physician.user.email.toLowerCase() !== dto.email.toLowerCase())
            throw new ConflictException('O e-mail deve corresponder ao cadastro existente deste médico.')
          if (
            await manager.getRepository(CompanyMembershipEntity).existsBy({
              companyId: context.companyId,
              userId: physician.userId,
            })
          )
            throw new ConflictException('Médico já vinculado. Gerencie o vínculo existente.')
        } else {
          const users = manager.getRepository(AuthUserEntity)
          const user = await users.save(
            users.create({
              email: dto.email,
              username: /^\d+\/[A-Z]{2}$/.test(crm) ? initialPassword : crm,
              fullName: profile?.name ?? dto.name.trim().replace(/\s+/g, ' '),
              passwordHash,
              status: 'ACTIVE',
              role: 'DOCTOR',
              mustChangePassword: true,
              accessRoleId: role.id,
            }),
          )
          physician = await physicians.save(
            physicians.create({
              userId: user.id,
              crm,
              name: user.fullName,
              specialtyId: specialty.id,
              registryProfile: profile,
              contactPhone: dto.contactPhone?.trim() || null,
            }),
          )
          physician.user = user
          physician.specialty = specialty
        }
        if (profile) {
          for (const registration of profile.registrations) {
            await manager.query(`INSERT INTO physician_crm_registrations(physician_id,crm,uf) VALUES($1,$2,$3)
              ON CONFLICT(crm,uf) DO NOTHING`, [physician.id, registration.crm, registration.uf])
            const [owner] = await manager.query<Array<{ physician_id: string }>>('SELECT physician_id FROM physician_crm_registrations WHERE crm=$1 AND uf=$2', [registration.crm, registration.uf])
            if (owner?.physician_id !== physician.id) throw new ConflictException('CRM já vinculado a outro médico.')
          }
          if (existingIdentity && !physician.registryProfile) {
            physician.registryProfile = profile
            await physicians.save(physician)
          }
        }
        const memberships = manager.getRepository(CompanyMembershipEntity)
        const membership = await memberships.save(
          memberships.create({
            companyId: context.companyId,
            userId: physician.userId,
            accessRoleId: role.id,
            active: true,
            allUnits: dto.allUnits,
            allowedPortals: dto.allowedPortals ?? ['sourad'],
          }),
        )
        await saveMembershipUnits(
          manager,
          membership.id,
          context.companyId,
          dto.allUnits ? [] : unitIds,
        )
        membership.user = physician.user
        membership.accessRole = role
        membership.unitLinks = await manager
          .getRepository(CompanyMembershipEntity)
          .findOneOrFail({
            where: { id: membership.id },
            relations: { unitLinks: { unit: true } },
          })
          .then((saved) => saved.unitLinks)
        await this.audit.record(
          context,
          {
            action: 'MEMBERSHIP_CREATED',
            resourceType: 'membership',
            resourceId: membership.id,
            metadata: {
              existingIdentity,
              physicianId: physician.id,
              allUnits: dto.allUnits,
              unitCount: unitIds.length,
            },
          },
          manager,
        )
        return {
          ...this.response(physician, membership, context),
          existingIdentity,
          initialPassword: existingIdentity ? null : initialPassword,
          accessEmail: await this.accessEmails.enqueue(manager, membership.id, !existingIdentity),
        }
      })
      this.accessEmails.requestDelivery()
      return result
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new ConflictException('CRM ou e-mail já cadastrado. Confira o cadastro existente.')
      }
      throw error
    }
  }

  revoke(id: string, context: CompanyAccessContext) {
    return this.setActive(id, false, context)
  }

  async resendAccessEmail(id: string, context: CompanyAccessContext) {
    const membership = await this.reader.query(context)
      .innerJoin(PhysicianEntity, 'physician', 'physician.user_id = membership.user_id')
      .andWhere('physician.id = :id', { id }).getOne()
    if (!membership) throw new NotFoundException('Médico não encontrado.')
    if (!this.reader.response(membership, context).canManage) throw new ForbiddenException('Acesso não autorizado.')
    if (!membership.active) throw new BadRequestException('O vínculo médico está revogado.')
    const rows = await this.database.query<Array<{ id: string }>>(`WITH queued AS (UPDATE physician_access_emails
      SET status='PENDING',attempts=0,next_attempt_at=now(),locked_until=NULL,sent_at=NULL,delivery_key=gen_random_uuid()
      WHERE membership_id=$1 AND status<>'PROCESSING' AND (sent_at IS NULL OR sent_at<now()-interval '1 minute') RETURNING id) SELECT * FROM queued`, [membership.id])
    if (!rows.length) throw new ConflictException('O convite está em processamento, foi enviado recentemente ou não está disponível.')
    this.accessEmails.requestDelivery()
    return { status: 'PENDING' as const, configured: this.accessEmails.configured }
  }
  reactivate(id: string, context: CompanyAccessContext) {
    return this.setActive(id, true, context)
  }

  listSpecialties() {
    return this.database.getRepository(MedicalSpecialtyEntity).find({
      select: { id: true, name: true },
      where: { active: true },
      order: { displayOrder: 'ASC' },
    })
  }

  private async setActive(id: string, active: boolean, context: CompanyAccessContext) {
    const membership = await this.reader
      .query(context)
      .innerJoin(PhysicianEntity, 'physician', 'physician.user_id = membership.user_id')
      .andWhere('physician.id = :physicianId', { physicianId: id })
      .getOne()
    if (!membership) throw new NotFoundException('Médico não encontrado.')
    const physician = await this.database.getRepository(PhysicianEntity).findOneOrFail({
      where: { id, userId: membership.userId },
      relations: { specialty: true },
    })
    await this.memberships.setActive(
      membership.id,
      active,
      context,
      'Alteração de acesso médico nesta empresa',
    )
    const updated = await this.reader.get(membership.id, context)
    const invitations = await this.accessEmails.summaries([membership.id])
    return { ...this.response(physician, updated, context), accessEmail: invitations.get(membership.id) ?? null }
  }

  private response(
    physician: PhysicianEntity,
    membership: CompanyMembershipEntity,
    context: CompanyAccessContext,
  ) {
    const access = this.reader.response(membership, context)
    return {
      id: physician.id,
      userId: physician.userId,
      name: physician.name,
      specialty: physician.specialty.name,
      specialtyId: physician.specialtyId,
      crm: physician.crm,
      username: membership.user.username,
      email: membership.user.email.endsWith('@internal.local') ? null : membership.user.email,
      contactPhone: physician.contactPhone,
      registryProfile: physician.registryProfile,
      enabledStates: physician.registryProfile?.registrations.filter(item => item.enabled).map(item => item.uf) ?? [],
      active: access.active,
      mustChangePassword: membership.user.mustChangePassword,
      createdAt: physician.createdAt,
      membershipId: membership.id,
      allowedPortals: membership.allowedPortals,
      canManage: access.canManage,
      allUnits: access.allUnits,
      unitIds: access.unitIds,
      units: access.units,
    }
  }
}
