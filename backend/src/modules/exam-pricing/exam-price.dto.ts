import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator'
export class CreateExamPriceDto {
  @IsUUID() examTypeId: string
  @IsOptional() @IsUUID() unitId?: string
  @IsOptional() @IsUUID() physicianId?: string
  @IsIn(['BILLING', 'PAYOUT']) kind: 'BILLING' | 'PAYOUT'
  @IsIn(['BRL']) currency: string
  @IsString() @Matches(/^(?:0|[1-9]\d{0,8})(?:[.,]\d{1,2})?$/) amount: string
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) validFrom: string
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) validTo?: string
  @IsString() @Length(3, 500) reason: string
}
export class CloseExamPriceDto {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) validTo: string
  @IsInt() @Min(0) expectedVersion: number
  @IsString() @Length(3, 500) reason: string
}
export class ResolveExamPriceDto {
  @IsUUID() examId: string
  @IsOptional() @IsUUID() physicianId?: string
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string
}
