import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import type { EntityManager, Repository } from 'typeorm'
import { OAuthClientEntity } from '../../database/entities/oauth-client.entity'

@Injectable()
export class OAuthClientService {
  constructor(
    @InjectRepository(OAuthClientEntity)
    private readonly clientRepository: Repository<OAuthClientEntity>,
    private readonly configService: ConfigService,
  ) {}

  async requireEnabled(clientId: string, manager?: EntityManager): Promise<OAuthClientEntity> {
    const configuredClientId = this.configService.getOrThrow<string>('OAUTH_CLIENT_ID')

    if (clientId !== configuredClientId) {
      throw new BadRequestException('Cliente OAuth inválido.')
    }

    const repository = manager ? manager.getRepository(OAuthClientEntity) : this.clientRepository
    const client = await repository.findOne({ where: { clientId, enabled: true } })

    if (!client) {
      throw new BadRequestException('Cliente OAuth inválido.')
    }

    return client
  }
}
