import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { ResearchAiService } from './research-ai.service'
import { ResearchReanalysisService } from './research-reanalysis.service'
import { ResearchFrameReviewService } from './research-frame-review.service'
import { ResearchViewerAccess } from './research-viewer-access.service'
import {
  ResearchFeedbackDto,
  ReviewResearchFrameDto,
  RunResearchDto,
  SaveResearchMasksDto,
} from './research-ai.dto'

// The temporary viewer capability is restricted to its original studies and
// live user session. Mutations additionally require the configured OHIF origin.
@Controller('dicom-viewer/:token/research')
export class ResearchViewerController {
  constructor(
    private readonly access: ResearchViewerAccess,
    private readonly research: ResearchAiService,
    private readonly reanalysis: ResearchReanalysisService,
    private readonly frames: ResearchFrameReviewService,
  ) {}
  @Get('exams/:examId/cases') async list(
    @Param('token') token: string,
    @Param('examId', ParseUUIDPipe) id: string,
    @Req() r: Request,
  ) {
    return this.research.list(id, await this.access.exam(token, id, r))
  }
  @Post('exams/:examId/cases') async create(
    @Param('token') token: string,
    @Param('examId', ParseUUIDPipe) id: string,
    @Req() r: Request,
  ) {
    return this.research.create(id, await this.access.exam(token, id, r))
  }
  @Get('cases/:id') async get(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: Request,
  ) {
    return this.research.get(id, await this.access.case(token, id, r))
  }
  @Get('cases/:id/frames/:frameId/image')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Type', 'image/png')
  async image(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('frameId', ParseUUIDPipe) frame: string,
    @Query('original') original: string,
    @Req() r: Request,
    @Res() res: Response,
  ) {
    res.send(
      await this.frames.image(id, frame, original === '1', await this.access.case(token, id, r)),
    )
  }
  @Put('cases/:id/frames/:frameId/masks') async masks(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('frameId', ParseUUIDPipe) frame: string,
    @Body() dto: SaveResearchMasksDto,
    @Req() r: Request,
  ) {
    return this.frames.masks(id, frame, dto, await this.access.case(token, id, r))
  }
  @Patch('cases/:id/frames/:frameId/review') async review(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('frameId', ParseUUIDPipe) frame: string,
    @Body() dto: ReviewResearchFrameDto,
    @Req() r: Request,
  ) {
    return this.frames.review(id, frame, dto, await this.access.case(token, id, r))
  }
  @Post('cases/:id/run') async run(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunResearchDto,
    @Req() r: Request,
  ) {
    return this.research.run(id, dto, await this.access.case(token, id, r))
  }
  @Post('cases/:id/feedback') async feedback(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResearchFeedbackDto,
    @Req() r: Request,
  ) {
    return this.research.feedback(id, dto, await this.access.case(token, id, r))
  }
  @Post('cases/:id/retry') async retry(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: Request,
  ) {
    return this.research.retry(id, await this.access.case(token, id, r))
  }
  @Post('cases/:id/reanalyze') async reanalyze(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: Request,
  ) {
    return this.reanalysis.create(id, await this.access.case(token, id, r))
  }
}
