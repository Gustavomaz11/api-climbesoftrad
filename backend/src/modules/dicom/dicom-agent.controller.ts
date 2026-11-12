import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { DicomAgentGuard, type DicomAgentRequest } from './dicom-agent.guard'
import { UploadSessionsService } from '../document-uploads/upload-sessions.service'
import { CreateUploadDto } from '../document-uploads/upload.dto'
import { AgentDiagnosticDto } from './dicom-source.dto'
import { DicomSourcesService } from './dicom-sources.service'
@Controller('dicom-agent')
// Agent batches have many small requests; retain bounded limits separate from interactive screens.
@Throttle({
  burst: { limit: 120, ttl: 10000 },
  default: { limit: 600, ttl: 60000 },
  sustained: { limit: 6000, ttl: 900000 },
})
@UseGuards(DicomAgentGuard)
export class DicomAgentController {
  constructor(
    private readonly sessions: UploadSessionsService,
    private readonly sources: DicomSourcesService,
  ) {}
  @Post('uploads') create(@Body() dto: CreateUploadDto, @Req() r: DicomAgentRequest) {
    if (dto.kind !== 'DICOM' || dto.unitId !== r.auth.selectedUnitId)
      throw new BadRequestException('Origem restrita à unidade configurada.')
    return this.sessions.create({ ...dto, sourceId: r.sourceId }, r.auth)
  }
  @Get('uploads/:id') get(@Param('id', ParseUUIDPipe) id: string, @Req() r: DicomAgentRequest) {
    return this.sessions.get(id, r.auth, r.sourceId)
  }
  @Post('uploads/:id/parts/:number') part(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('number', ParseIntPipe) n: number,
    @Req() r: DicomAgentRequest,
  ) {
    return this.sessions.sign(id, n, r.auth, r.sourceId)
  }
  @Post('uploads/:id/complete') complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: DicomAgentRequest,
  ) {
    return this.sessions.complete(id, r.auth, r.sourceId)
  }
  @Post('uploads/:id/cancel') cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: DicomAgentRequest,
  ) {
    return this.sessions.cancel(id, r.auth, r.sourceId)
  }
  @Post('heartbeat') heartbeat(@Body() dto: AgentDiagnosticDto, @Req() r: DicomAgentRequest) {
    return this.sources.heartbeat(r.sourceId, dto)
  }
}
