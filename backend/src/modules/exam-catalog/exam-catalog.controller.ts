import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { ExamCatalogService } from './exam-catalog.service'
import { ExamDescriptionResolverService } from './exam-description-resolver.service'
import { ExamClassificationService } from './exam-classification.service'
import {
  SaveExamTypeDto,
  SaveExamAliasDto,
  ResolveExamDescriptionDto,
  ClassifyExamDto,
} from './dto/exam-catalog.dto'
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('exam-catalog')
export class ExamCatalogController {
  constructor(
    private readonly catalog: ExamCatalogService,
    private readonly resolver: ExamDescriptionResolverService,
    private readonly classification: ExamClassificationService,
  ) {}
  @Get() @RequirePermissions('exam.catalog.view') list(@Req() req: CompanyAuthenticatedRequest) {
    return this.catalog.list(req.auth)
  }
  @Post('types') @RequirePermissions('exam.catalog.manage') createType(
    @Body() dto: SaveExamTypeDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.catalog.saveType(undefined, dto, req.auth)
  }
  @Put('types/:id') @RequirePermissions('exam.catalog.manage') updateType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveExamTypeDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.catalog.saveType(id, dto, req.auth)
  }
  @Post('aliases') @RequirePermissions('exam.catalog.manage') createAlias(
    @Body() dto: SaveExamAliasDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.catalog.saveAlias(undefined, dto, req.auth)
  }
  @Put('aliases/:id') @RequirePermissions('exam.catalog.manage') updateAlias(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveExamAliasDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.catalog.saveAlias(id, dto, req.auth)
  }
  @Post('resolve') @RequirePermissions('exam.catalog.view') resolve(
    @Body() dto: ResolveExamDescriptionDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.resolver.preview(dto, req.auth)
  }
  @Get('pending') @RequirePermissions('exam.classification.review', 'exams.view') pending(
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.classification.list(req.auth)
  }
  @Post('exams/:id/classification')
  @RequirePermissions('exam.classification.review', 'exams.view')
  classify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClassifyExamDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.classification.classify(id, dto, req.auth)
  }
}
