import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  Max,
  IsUUID,
  ValidateNested,
  IsObject,
  Matches,
} from 'class-validator'
export class ImportedIdentifierRowDto {
  @IsUUID() unitId: string
  @IsString() @Length(2, 120) issuer: string
  @IsString() @Length(1, 120) externalId: string
  @IsUUID() patientId: string
  @IsString() @Length(0, 120) legacyIssuer: string = ''
  @IsString() @Length(0, 120) legacyExternalId: string = ''
}
export class ReviewImportRowDto {
  @IsInt() @Min(0) expectedVersion: number
  @IsBoolean() included: boolean
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ImportedIdentifierRowDto)
  data?: ImportedIdentifierRowDto
  @IsString() @Length(3, 500) @Matches(/\S/) reason: string
}
export class CommitImportDto {
  @IsInt() @Min(1) @Max(100) limit: number = 50
}

export class UndoImportRowDto {
  @IsInt() @Min(0) expectedVersion: number
  @IsString() @Length(3, 500) @Matches(/\S/) reason: string
}
