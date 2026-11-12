import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { UploadSessionEntity } from '../../database/entities/upload-session.entity'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { R2MultipartStorage } from '../file-validation/r2-multipart-storage.service'
import { UploadScopeService } from './upload-scope.service'
import { expectedPartSize } from './upload.policy'
@Injectable()
export class UploadPartProxyService {
  constructor(
    private readonly database: DataSource,
    private readonly scope: UploadScopeService,
    private readonly storage: R2MultipartStorage,
  ) {}
  async put(id: string, number: number, request: CompanyAuthenticatedRequest) {
    await this.scope.require(id, request.auth)
    if (request.get('Content-Type') !== 'application/octet-stream')
      throw new BadRequestException('Envie bytes binários da parte.')
    return this.database.transaction(async (manager) => {
      const session = await manager
        .getRepository(UploadSessionEntity)
        .findOneOrFail({ where: { id }, lock: { mode: 'pessimistic_write' } })
      if (session.status !== 'UPLOADING' || session.expiresAt.getTime() <= Date.now())
        throw new ConflictException('Sessão encerrada ou expirada.')
      const expected = expectedPartSize(session.sizeBytes, number)
      if (Number(request.get('Content-Length')) !== expected)
        throw new BadRequestException('Tamanho da parte divergente.')
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) throw new BadRequestException('Parte inválida.')
        size += chunk.length
        if (size > expected) throw new BadRequestException('Parte excede o limite.')
        chunks.push(chunk)
      }
      if (size !== expected) throw new BadRequestException('Parte incompleta.')
      // Memory is bounded to one fixed 8 MiB part, never an entire study.
      await this.storage.putPart(
        session.storageKey,
        session.multipartId,
        number,
        Buffer.concat(chunks, size),
      )
      return { number, sizeBytes: size }
    })
  }
}
