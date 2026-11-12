import { Body, Controller, Get, Injectable, Module, Param, Post, Put, Req, UseGuards, ConflictException, ForbiddenException } from '@nestjs/common'
import { Transform } from 'class-transformer'
import { IsBoolean, IsString, Length, Matches } from 'class-validator'
import { DataSource } from 'typeorm'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthSessionEntity } from '../../database/entities/auth-session.entity'
import { AccessTokenGuard } from '../auth/guards/access-token.guard'
import { PasswordChangedGuard } from '../auth/guards/password-changed.guard'
import { PermissionGuard } from '../auth/guards/permission.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { AuthModule } from '../auth/auth.module'
import { CompanyAccessModule } from '../companies/company-access.module'
import { CompanyContextGuard } from '../companies/company-context.guard'
import type { CompanyAuthenticatedRequest, CompanyAccessContext } from '../companies/company-context.contracts'
import { OperationalAuditService } from '../companies/operational-audit.service'
import { CompaniesModule } from '../companies/companies.module'
import { standardModalities } from './standard-modalities'

export class SaveModalityDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,15}$/) code: string
  @Transform(({value}: {value:unknown})=>typeof value==='string' ? value.trim() : value)
  @IsString() @Length(2, 180) name: string
  @IsBoolean() active: boolean
}
export interface ExamModalityRecord { code: string; name: string; active: boolean; standard: boolean }

@Injectable()
export class ExamModalitiesService {
  constructor(private readonly database: DataSource, private readonly audit: OperationalAuditService) {}
  async list(context: CompanyAccessContext) {
    await this.database.query(`INSERT INTO exam_modalities(company_id,code,name,standard)
      SELECT $1,code,name,true FROM jsonb_to_recordset($2::jsonb) AS defaults(code text,name text) ON CONFLICT DO NOTHING`,
    [context.companyId, JSON.stringify(standardModalities)])
    return this.database.query<ExamModalityRecord[]>('SELECT code,name,active,standard FROM exam_modalities WHERE company_id=$1 ORDER BY name', [context.companyId])
  }
  async save(dto: SaveModalityDto, context: CompanyAccessContext, update: boolean) {
    if (!context.allUnits) throw new ForbiddenException('Selecione todas as unidades para administrar as modalidades da empresa.')
    return this.database.transaction(async manager => {
      const result = update
        ? await manager.query<ExamModalityRecord[]>('WITH updated AS (UPDATE exam_modalities SET name=$3,active=$4 WHERE company_id=$1 AND code=$2 RETURNING code,name,active,standard) SELECT * FROM updated', [context.companyId, dto.code, dto.name.trim(), dto.active])
        : await manager.query<ExamModalityRecord[]>('INSERT INTO exam_modalities(company_id,code,name,active) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING code,name,active,standard', [context.companyId, dto.code, dto.name.trim(), dto.active])
      if (!result[0]) throw new ConflictException('Modalidade já cadastrada ou indisponível. Recarregue a lista.')
      await this.audit.record(context, { action: 'EXAM_MODALITY_SAVED', resourceType: 'company', resourceId: context.companyId, metadata: { code: dto.code, active: dto.active } }, manager)
      return result[0]
    })
  }
}

@Controller('exam-modalities')
@UseGuards(AccessTokenGuard, PasswordChangedGuard, CompanyContextGuard, PermissionGuard)
class ExamModalitiesController {
  constructor(private readonly modalities: ExamModalitiesService) {}
  // The company reference catalog is also used by hospital/exam-entry users.
  @Get()
  list(@Req() req: CompanyAuthenticatedRequest) { return this.modalities.list(req.auth) }
  @Post() @RequirePermissions('exam.catalog.manage')
  create(@Body() dto: SaveModalityDto, @Req() req: CompanyAuthenticatedRequest) { return this.modalities.save(dto, req.auth, false) }
  @Put(':code') @RequirePermissions('exam.catalog.manage')
  update(@Param('code') code: string, @Body() dto: SaveModalityDto, @Req() req: CompanyAuthenticatedRequest) {
    if (code !== dto.code) throw new ConflictException('O código da modalidade não pode ser alterado.')
    return this.modalities.save(dto, req.auth, true)
  }
}
@Module({ imports: [AuthModule, CompanyAccessModule, CompaniesModule, TypeOrmModule.forFeature([AuthSessionEntity])], controllers: [ExamModalitiesController], providers: [ExamModalitiesService], exports: [ExamModalitiesService] })
export class ExamModalitiesModule {}
