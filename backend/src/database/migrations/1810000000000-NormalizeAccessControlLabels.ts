import type { MigrationInterface, QueryRunner } from 'typeorm'
import { permissionCatalog } from '../../modules/access-control/permission.catalog'

const roleLabels = [
  ['ADMINISTRATOR', 'Administrador', 'Acesso total e imutável ao sistema.'],
  ['DOCTOR', 'Médico', 'Laudos, prescrições e atividades clínicas.'],
  ['RECEPTION', 'Recepção', 'Cadastro e acompanhamento operacional de exames.'],
  ['TECHNICIAN', 'Técnico', 'Operação técnica e anexos dos exames.'],
  ['READ_ONLY', 'Somente leitura', 'Consulta sem alteração de dados.'],
] as const

export class NormalizeAccessControlLabels1810000000000 implements MigrationInterface {
  name = 'NormalizeAccessControlLabels1810000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const permission of permissionCatalog) {
      await queryRunner.query(
        'UPDATE access_permissions SET group_name = $2, name = $3 WHERE code = $1',
        [permission.code, permission.group, permission.name],
      )
    }
    for (const [code, name, description] of roleLabels) {
      await queryRunner.query(
        'UPDATE access_roles SET name = $2, description = $3, updated_at = NOW() WHERE code = $1',
        [code, name, description],
      )
    }
  }

  async down(): Promise<void> {}
}
