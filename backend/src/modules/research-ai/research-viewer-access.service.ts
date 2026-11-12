import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'
import { DicomViewerGrantsService } from '../dicom/dicom-viewer-grants.service'
import { ResearchAiService } from './research-ai.service'

@Injectable()
export class ResearchViewerAccess {
  constructor(
    private readonly grants: DicomViewerGrantsService,
    private readonly research: ResearchAiService,
    private readonly config: ConfigService,
  ) {}
  private async scope(token: string, request: Request) {
    if (request.method !== 'GET') {
      const viewer = this.config.get<string>('OHIF_VIEWER_URL')
      if (
        !viewer ||
        request.get('Origin') !== new URL(viewer).origin ||
        request.get('X-Requested-With') !== 'XMLHttpRequest'
      )
        throw new ForbiddenException('Origem da pesquisa inválida.')
    }
    const scope = await this.grants.require(token)
    if (scope.grant.intakeId || !scope.context.permissions.includes('research.ai.use'))
      throw new ForbiddenException()
    return scope
  }
  async exam(token: string, id: string, request: Request) {
    const scope = await this.scope(token, request)
    if (!scope.studies.some((study) => 'examId' in study && study.examId === id))
      throw new NotFoundException('Exame fora do acesso temporário.')
    await this.research.scope(id, scope.context)
    return scope.context
  }
  async case(token: string, id: string, request: Request) {
    const scope = await this.scope(token, request),
      job = await this.research.require(id, scope.context)
    if (!scope.studies.some((study) => 'examId' in study && study.examId === job.exam_id))
      throw new NotFoundException('Pesquisa fora do acesso temporário.')
    return scope.context
  }
}
