import type { PortalKind } from '../../companies/portal-access'
import { Transform } from 'class-transformer'
import { MembershipUnitsDto } from '../../companies/dto/membership.dto'
import { ArrayMinSize, ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsEmail, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator'

export class CreatePhysicianDto extends MembershipUnitsDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique()
  @IsIn(['sourad', 'hospital', 'configuracoes'], { each: true })
  allowedPortals?: PortalKind[]

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @Length(3, 254)
  email: string

  override allUnits = true
  @IsOptional() @IsUUID() registryLookupId?: string
  @IsOptional() @IsString() @Length(0, 30) @Matches(/^[+\d() .-]*$/) contactPhone?: string
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @Length(2, 120)
  name: string

  @IsOptional() @IsUUID()
  specialtyId?: string

  @IsString()
  @Length(3, 40)
  @Matches(/^[A-Za-z0-9./ -]+$/)
  crm: string
}
