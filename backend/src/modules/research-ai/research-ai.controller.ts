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
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { ResearchAiService } from './research-ai.service'
import { ResearchReanalysisService } from './research-reanalysis.service'
import { ResearchFrameReviewService } from './research-frame-review.service'
import {
  ResearchFeedbackDto,
  ReviewResearchFrameDto,
  RunResearchDto,
  SaveResearchMasksDto,
} from './research-ai.dto'

@Controller('research-ai')
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@RequirePermissions('research.ai.use', 'exams.view', 'exams.viewer.open')
export class ResearchAiController {
  constructor(
    private readonly research: ResearchAiService,
    private readonly reanalysis: ResearchReanalysisService,
    private readonly frames: ResearchFrameReviewService,
  ) {}
  @Get('exams/:examId/cases') list(
    @Param('examId', ParseUUIDPipe) id: string,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.research.list(id, r.auth)
  }
  @Post('exams/:examId/cases') create(
    @Param('examId', ParseUUIDPipe) id: string,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.research.create(id, r.auth)
  }
  @Get('cases/:id') get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.research.get(id, r.auth)
  }
  @Get('cases/:id/frames/:frameId/image')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Type', 'image/png')
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('frameId', ParseUUIDPipe) frame: string,
    @Query('original') original: string,
    @Req() r: CompanyAuthenticatedRequest,
    @Res() res: Response,
  ) {
    res.send(await this.frames.image(id, frame, original === '1', r.auth))
  }
  @Put('cases/:id/frames/:frameId/masks') masks(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('frameId', ParseUUIDPipe) frame: string,
    @Body() dto: SaveResearchMasksDto,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.frames.masks(id, frame, dto, r.auth)
  }
  @Patch('cases/:id/frames/:frameId/review') review(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('frameId', ParseUUIDPipe) frame: string,
    @Body() dto: ReviewResearchFrameDto,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.frames.review(id, frame, dto, r.auth)
  }
  @Post('cases/:id/run') run(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunResearchDto,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.research.run(id, dto, r.auth)
  }
  @Post('cases/:id/feedback') feedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResearchFeedbackDto,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.research.feedback(id, dto, r.auth)
  }
  @Post('cases/:id/retry') retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.research.retry(id, r.auth)
  }
  @Post('cases/:id/reanalyze') reanalyze(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: CompanyAuthenticatedRequest,
  ) {
    return this.reanalysis.create(id, r.auth)
  }
}
