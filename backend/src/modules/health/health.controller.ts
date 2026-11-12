import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { DataSource } from 'typeorm'

@ApiTags('Saúde da aplicação')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOkResponse({ description: 'API e PostgreSQL disponíveis' })
  async check() {
    try {
      await this.dataSource.query('SELECT 1')
      return { status: 'ok', database: 'available' }
    } catch {
      throw new ServiceUnavailableException('Serviço temporariamente indisponível.')
    }
  }
}
