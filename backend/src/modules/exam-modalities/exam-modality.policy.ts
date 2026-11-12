import { BadRequestException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import { standardModalities } from './standard-modalities'

export const requireActiveModality = async (manager: EntityManager, companyId: string, code: string) => {
  const [record] = await manager.query<Array<{active: boolean}>>('SELECT active FROM exam_modalities WHERE company_id=$1 AND code=$2',[companyId,code])
  // A newly created company can use the standard catalog before its first settings visit.
  if (record?.active || (!record && standardModalities.some(item=>item.code===code))) return
  throw new BadRequestException('Selecione uma modalidade cadastrada e ativa nesta empresa.')
}
