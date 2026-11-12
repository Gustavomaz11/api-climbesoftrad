import { Transform, Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsOptional, IsNotEmpty, IsString, MaxLength, MinLength, Matches, IsEmail, ValidateNested } from 'class-validator'
import { brazilStates } from '../../physicians/physician-registry.policy'

export class UnitAddressDto {
  @IsString() @Matches(/^\d{8}$/) zipCode: string
  @IsString() @IsNotEmpty() @MaxLength(160) street: string
  @IsString() @IsNotEmpty() @MaxLength(30) number: string
  @IsString() @IsNotEmpty() @MaxLength(120) neighborhood: string
  @IsString() @IsNotEmpty() @MaxLength(120) city: string
}
export class CnpjLookupDto { @IsString() @MaxLength(18) cnpj: string }
export class CreateHospitalUnitDto {
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string
  @IsOptional() @IsString() @MaxLength(160) legalName?: string
  @IsOptional() @IsString() @MaxLength(160) tradeName?: string
  @IsOptional() @IsString() @MaxLength(120) internalIdentifier?: string
  @IsOptional() @ValidateNested() @Type(() => UnitAddressDto) address?: UnitAddressDto
  @IsOptional() @IsString() @MaxLength(30) contactPhone?: string
  @IsOptional() @IsEmail() @MaxLength(254) contactEmail?: string
  @IsOptional() @IsIn(brazilStates) uf?: string
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @ApiProperty({ example: 'Hospital Central' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name: string
}
