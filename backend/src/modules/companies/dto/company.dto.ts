import { Type, Transform } from 'class-transformer'
import {
  IsBoolean,
  IsDefined,
  IsObject,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class SaveCompanyDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @Length(2, 120)
  name: string
}

export class CompanyStatusDto {
  @IsBoolean()
  active: boolean

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}

export class PresentationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  headerText?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  footerText?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  signatureText?: string
}

export class SaveCompanySettingsDto {
  @IsInt()
  @Min(0)
  expectedVersion: number

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PresentationDto)
  presentation: PresentationDto

  @IsOptional()
  @IsUUID()
  unitId?: string
}
