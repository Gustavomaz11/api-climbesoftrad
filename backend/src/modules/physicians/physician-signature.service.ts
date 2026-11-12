import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { DataSource } from 'typeorm'
import { PhysicianEntity } from '../../database/entities/physician.entity'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import type { PhysicianSignatureImage } from './physician-signature.contract'
import { normalizePhysicianSignature } from './physician-signature-image'

@Injectable()
export class PhysicianSignatureService {
  constructor(private readonly db: DataSource, private readonly audit: OperationalAuditService) {}

  private authorize(context: CompanyAccessContext) {
    if (context.role !== 'DOCTOR') throw new ForbiddenException('A assinatura deve ser cadastrada pelo próprio médico.')
    if (context.mustChangePassword) throw new ForbiddenException('Altere sua senha inicial antes de cadastrar a assinatura.')
  }
  async get(context: CompanyAccessContext) {
    this.authorize(context)
    const physician = await this.db.getRepository(PhysicianEntity).createQueryBuilder('p')
      .addSelect('p.signatureImage').where('p.user_id=:user', { user: context.userId }).getOne()
    if (!physician) throw new ForbiddenException('Cadastro médico indisponível.')
    return { signature: physician.signatureImage }
  }
  async save(file: Express.Multer.File | undefined, context: CompanyAccessContext) {
    this.authorize(context)
    if (!file || file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.mimetype))
      throw new BadRequestException('Importe uma imagem PNG ou JPEG de até 2 MB.')
    let bytes: Buffer
    try {
      bytes = await normalizePhysicianSignature(file.buffer, file.mimetype)
    } catch { throw new BadRequestException('Imagem inválida ou sem assinatura visível. Utilize uma imagem nítida da assinatura.') }
    const signature: PhysicianSignatureImage = { id: randomUUID(), dataUrl: 'data:image/png;base64,' + bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'), registeredAt: new Date().toISOString() }
    await this.db.transaction(async manager => {
      const result = await manager.getRepository(PhysicianEntity).update({ userId: context.userId }, { signatureImage: signature })
      if (!result.affected) throw new ForbiddenException('Cadastro médico indisponível.')
      await this.audit.record(context, { action: 'PHYSICIAN_SIGNATURE_SAVED', resourceType: 'physician',
        resourceId: context.userId, metadata: { signatureId: signature.id, sha256: signature.sha256 } }, manager)
    })
    return { signature }
  }
}
