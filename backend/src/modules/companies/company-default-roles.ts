import type { EntityManager } from 'typeorm'
import { AccessRoleEntity } from '../../database/entities/access-role.entity'
import { AccessPermissionEntity } from '../../database/entities/access-permission.entity'
import { defaultRolePermissions } from '../access-control/permission.catalog'

const roleDefinitions = [
  ['HOSPITAL', 'Hospital — envio de exames', 'Prepara estudos da unidade e envia à SouRad.', false],
  ['ADMINISTRATOR', 'Administrador', 'Administração desta empresa.', true],
  ['DOCTOR', 'Médico', 'Atividades clínicas nas unidades autorizadas.', false],
  ['RECEPTION', 'Recepção', 'Preparação e acompanhamento de exames.', false],
  ['TECHNICIAN', 'Técnico', 'Operação técnica nas unidades autorizadas.', false],
  ['READ_ONLY', 'Somente leitura', 'Consulta nas unidades autorizadas.', false],
] as const

export const seedCompanyRoles = async (manager: EntityManager, companyId: string) => {
  const permissions = await manager.getRepository(AccessPermissionEntity).find()
  const roles = manager.getRepository(AccessRoleEntity)
  for (const [code, name, description, immutable] of roleDefinitions) {
    await roles.save(
      roles.create({
        companyId,
        code,
        name,
        description,
        immutable,
        active: true,
        permissions: permissions.filter((permission) =>
          (defaultRolePermissions[code] ?? []).includes(
            permission.code as (typeof defaultRolePermissions)[string][number],
          ),
        ),
      }),
    )
  }
}
