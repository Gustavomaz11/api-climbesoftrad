import { Injectable, UnauthorizedException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import type { Repository } from 'typeorm'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { CompanyScopeService } from '../companies/company-scope.service'
import type { AuthenticatedUserDto } from './dto/authenticated-user.dto'
import { physicianNeedsSignature } from '../physicians/physician-signature-status'

@Injectable()
export class AuthenticatedUserService {
  constructor(
    @InjectRepository(AuthUserEntity)
    private readonly userRepository: Repository<AuthUserEntity>,
    private readonly companies: CompanyScopeService,
  ) {}

  async getById(
    userId: string,
    companyId?: string,
    unitId?: string,
  ): Promise<AuthenticatedUserDto> {
    const user = await this.userRepository.findOneBy({ id: userId, status: 'ACTIVE' })
    if (!user) throw new UnauthorizedException('Sessão inválida.')
    const isPlatformAdmin = user.role === 'ADMIN'
    const available = await this.companies.available(user.id, isPlatformAdmin)
    const selected = companyId || available.find(item=>item.id===this.companies.centralCompanyId)?.id || (available.length === 1 ? available[0]?.id : undefined)
    const context = selected
      ? await this.companies.resolve(
          {
            userId,
            sessionId: '',
            role: user.role,
            isPlatformAdmin,
            correlationId: randomUUID(),
            mustChangePassword: user.mustChangePassword,
            accessRoleId: '',
            accessRoleName: '',
            permissions: [],
          },
          selected,
          unitId,
        )
      : null
    const company = available.find((item) => item.id === context?.companyId)
    return {
      id: user.id,
      centralCompanyId: this.companies.centralCompanyId,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      mustUploadSignature: await physicianNeedsSignature(this.userRepository.manager, user.role, user.id),
      isPlatformAdmin,
      accessRole: company?.accessRole ?? { id: '', code: '', name: 'Selecione uma empresa' },
      permissions: context?.permissions ?? [],
      allowedPortals: context?.allowedPortals ?? [],
      companies: available,
      activeCompany: context
        ? {
            id: context.companyId,
            name: context.companyName,
            membershipId: context.membershipId,
            allUnits: context.allUnits,
            unitIds: context.unitIds,
            selectedUnitId: context.selectedUnitId,
          }
        : null,
    }
  }
}
