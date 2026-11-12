import { Controller, Get, HttpCode, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest } from '../companies/company-context.contracts'
import { PhysicianSignatureService } from './physician-signature.service'

@Controller('physicians/me/signature')
@UseGuards(AccessTokenGuard, CompanyContextGuard)
export class PhysicianSignatureController {
  constructor(private readonly signatures: PhysicianSignatureService) {}
  @Get() get(@Req() request: CompanyAuthenticatedRequest) { return this.signatures.get(request.auth) }
  @Post() @HttpCode(200)
  @UseInterceptors(FileInterceptor('signature', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  save(@UploadedFile() file: Express.Multer.File | undefined, @Req() request: CompanyAuthenticatedRequest) {
    return this.signatures.save(file, request.auth)
  }
}
