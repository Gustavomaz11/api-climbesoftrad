import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'
import type { CompanyAccessContext } from '../companies/company-context.contracts'
import type { CompletedReportRow } from './report-completion.contracts'
import { registryAllowsState, type PhysicianRegistryProfile } from '../physicians/physician-registry.policy'

export const reportReason = (reason: string) => {
  const trimmed=reason.trim()
  if(trimmed.length<10 || trimmed.length>500) throw new BadRequestException('Informe uma justificativa entre 10 e 500 caracteres.')
  return trimmed
}
export const requireReportingDoctor = async (unitId: string, context: CompanyAccessContext, manager: EntityManager) => {
  if(context.role!=='DOCTOR' || !context.permissions.includes('reports.edit')) throw new ForbiddenException('Somente um médico autorizado pode editar o laudo.')
  const [physician]=await manager.query<Array<{registry_profile:PhysicianRegistryProfile|null;uf:string|null;active:boolean}>>(
    'SELECT p.registry_profile,u.uf,u.active FROM physicians p JOIN hospital_units u ON u.id=$2 WHERE p.user_id=$1', [context.userId,unitId])
  if(!physician?.active || !registryAllowsState(physician.registry_profile,physician.uf)) throw new ForbiddenException('Médico sem inscrição regular para esta unidade.')
}
export const assertRevisionAuthorized = async (base: CompletedReportRow, context: CompanyAccessContext, manager: EntityManager) => {
  await requireReportingDoctor(base.unit_id,context,manager)
  if(!context.permissions.includes('reports.finalize')) throw new ForbiddenException('Médico sem permissão para assinar laudos.')
  if(base.physician_user_id===context.userId || context.permissions.includes('reports.resign.other')) return
  const [grant]=await manager.query<unknown[]>('SELECT id FROM exam_report_authorizations WHERE base_completion_id=$1 AND physician_user_id=$2',[base.id,context.userId])
  if(!grant) throw new ForbiddenException('A gerência precisa autorizar este médico a reassinar esta versão do laudo.')
}
