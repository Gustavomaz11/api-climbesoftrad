import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  IsDateString,
  Matches,
} from 'class-validator'
import { type ExamModality } from '../../../database/entities/exam.entity'
export class SaveExamTypeDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 180)
  name: string
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,15}$/) modality: ExamModality
  @IsString() @Length(2, 120) @Matches(/\S/) groupName: string
  @IsBoolean() active: boolean = true
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number
}
export class SaveExamAliasDto {
  @IsUUID() examTypeId: string
  @IsOptional() @IsUUID() unitId?: string
  @IsOptional() @IsString() @Length(2, 120) issuer?: string
  @IsString() @Length(2, 180) @Matches(/\S/) description: string
  @IsBoolean() active: boolean = true
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number
}
export class ResolveExamDescriptionDto {
  @IsUUID() unitId: string
  @IsOptional() @IsString() @Length(2, 120) issuer?: string
  @IsString() @Length(2, 180) @Matches(/\S/) description: string
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,15}$/) modality: ExamModality
}
export class ClassifyExamDto {
  @IsUUID() examTypeId: string
  @IsDateString() expectedUpdatedAt: string
  @IsBoolean() teachAlias: boolean = false
  @IsString() @Length(3, 500) @Matches(/\S/) reason: string
}
