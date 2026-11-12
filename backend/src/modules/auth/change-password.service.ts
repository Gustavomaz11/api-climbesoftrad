import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { AuthUserEntity } from '../../database/entities/auth-user.entity'
import { CryptoService } from './crypto.service'
import type { ChangePasswordDto } from './dto/change-password.dto'

@Injectable()
export class ChangePasswordService {
  constructor(
    @InjectRepository(AuthUserEntity)
    private readonly users: Repository<AuthUserEntity>,
    private readonly crypto: CryptoService,
  ) {}

  async change(userId: string, dto: ChangePasswordDto) {
    const user = await this.users.findOne({ where: { id: userId, status: 'ACTIVE' } })
    if (!user) throw new UnauthorizedException('Sessão inválida.')

    const currentPasswordMatches = await this.crypto.verifyPassword(
      user.passwordHash,
      dto.currentPassword,
    )
    if (!currentPasswordMatches) throw new BadRequestException('A senha atual está incorreta.')
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da senha atual.')
    }

    user.passwordHash = await this.crypto.hashPassword(dto.newPassword)
    user.mustChangePassword = false
    await this.users.save(user)
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    }
  }
}
