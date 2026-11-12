import { Transform } from 'class-transformer'
import {
  IsString,
  Length,
  MaxLength,
  IsOptional,
  IsIn,
  IsDateString,
  IsEmail,
  IsUUID,
  IsInt,
  Min,
  Matches,
} from 'class-validator'
export class PatientDemographicsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @Length(2, 120)
  fullName: string
  @IsOptional() @IsString() @MaxLength(120) socialName?: string | null
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) birthDate?:
    string | null
  @IsOptional() @IsIn(['MASCULINO', 'FEMININO']) sex?: 'MASCULINO' | 'FEMININO' | null
  @IsString() @Length(2, 80) country: string = 'Brasil'
  @IsOptional() @IsEmail() @MaxLength(255) email?: string | null
}
export class CreatePatientDto extends PatientDemographicsDto {
  @IsUUID() unitId: string
}
export class CorrectPatientDto extends PatientDemographicsDto {
  @IsInt() @Min(0) expectedVersion: number
  @IsString() @Length(3, 500) @Matches(/\S/) reason: string
}
export class AddIdentifierDto {
  @IsUUID() unitId: string
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 120)
  issuer: string
  @IsString() @Length(1, 120) @Matches(/\S/) originalValue: string
  @IsString() @Length(3, 500) @Matches(/\S/) reason: string
}
export class DecidePatientReviewDto {
  @IsIn(['APPROVE', 'REJECT']) decision: 'APPROVE' | 'REJECT'
  @IsInt() @Min(0) expectedVersion: number
  @IsOptional() @IsUUID() targetPatientId?: string
  @IsOptional() @IsInt() @Min(0) expectedTargetVersion?: number
  @IsInt() @Min(0) expectedSourceVersion: number
  @IsString() @Length(3, 500) @Matches(/\S/) reason: string
}
export class UndoPatientLinkDto {
  @IsInt() @Min(0) expectedVersion: number
  @IsString() @Length(3, 500) @Matches(/\S/) reason: string
}
export class PatientListQuery {
  @IsOptional() @IsString() @MaxLength(120) search?: string
  @IsOptional() @IsUUID() unitId?: string
  @IsOptional() @IsIn(['OPEN', 'APPROVED', 'REJECTED', 'REVERTED']) status?: string
}

export class OpenPatientReviewDto {
  @IsInt() @Min(0) expectedVersion: number
  @IsString() @Length(3, 500) @Matches(/\S/) reason: string
}
