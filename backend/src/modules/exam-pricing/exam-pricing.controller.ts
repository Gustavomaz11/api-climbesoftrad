import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { CloseExamPriceDto, CreateExamPriceDto, ResolveExamPriceDto } from './exam-price.dto'
import { ExamPricingService } from './exam-pricing.service'
@ApiTags('Preços de exames')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
@Controller('exam-prices')
export class ExamPricingController {
  constructor(private readonly prices: ExamPricingService) {}
  @Get() @RequirePermissions('exam.prices.view') list(@Req() req: CompanyAuthenticatedRequest) {
    return this.prices.list(req.auth)
  }
  @Get('resolve') @RequirePermissions('exam.prices.view', 'exams.view') resolve(
    @Query() dto: ResolveExamPriceDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.prices.resolve(dto, req.auth)
  }
  @Post() @RequirePermissions('exam.prices.manage') create(
    @Body() dto: CreateExamPriceDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.prices.create(dto, req.auth)
  }
  @Post(':id/close') @RequirePermissions('exam.prices.manage') close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseExamPriceDto,
    @Req() req: CompanyAuthenticatedRequest,
  ) {
    return this.prices.close(id, dto, req.auth)
  }
}
