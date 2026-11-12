import { Injectable, ServiceUnavailableException, Logger } from '@nestjs/common'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

@Injectable()
export class RouterMsiService {
  async build(directory: string, unitId: string) {
    try {
      await promisify(execFile)(process.execPath, [resolve(__dirname, '../../../../router/scripts/build-unit-msi.cjs'), directory, unitId], { windowsHide: true, timeout: 120000 })
    } catch {
      Logger.error('Não foi possível gerar o pacote MSI. Verifique WiX e o modelo do Router no servidor.', 'RouterMsiService')
      throw new ServiceUnavailableException('Não foi possível preparar o instalador MSI do Router.')
    }
  }
}
