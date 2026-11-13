import type { PortalKind } from '../portal-access'
import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator'

export class MembershipUnitsDto {
  @IsBoolean()
  allUnits: boolean

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  unitIds: string[] = []

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}

export class MembershipPortalsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique()
  @IsIn(['sourad', 'hospital', 'configuracoes'], { each: true })
  allowedPortals: PortalKind[]
}

export class ProvisionCompanyUserDto extends MembershipUnitsDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique()
  @IsIn(['sourad', 'hospital', 'configuracoes'], { each: true })
  allowedPortals?: PortalKind[]

  @IsEmail()
  @MaxLength(255)
  email: string

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @Length(2, 120)
  fullName: string

  @IsUUID()
  roleId: string
}

export class MembershipPreferencesDto {
  @IsInt()
  @Min(0)
  expectedVersion: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  signatureText?: string | null
}

export class MembershipStatusDto {
  @IsBoolean()
  active: boolean

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
