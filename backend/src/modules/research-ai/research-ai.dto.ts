import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
export class RedactionDto {
  @IsNumber() @Min(0) @Max(1) x: number
  @IsNumber() @Min(0) @Max(1) y: number
  @IsNumber() @Min(0.00001) @Max(1) width: number
  @IsNumber() @Min(0.00001) @Max(1) height: number
}
export class SaveResearchMasksDto {
  @IsInt() @Min(1) expectedRevision: number
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => RedactionDto)
  masks: RedactionDto[]
}
export class ReviewResearchFrameDto {
  @IsInt() @Min(1) expectedRevision: number
  @IsBoolean() reviewed: boolean
}
export class RunResearchDto {
  @IsBoolean() confirmsAnonymization: boolean
  @IsBoolean() nonClinicalResearch: boolean
}
export class ResearchFeedbackDto {
  @IsBoolean() useful: boolean
  @IsOptional() @IsString() @MaxLength(1000) comment?: string
}
