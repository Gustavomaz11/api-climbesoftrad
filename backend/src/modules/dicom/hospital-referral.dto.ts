import { IsBoolean, IsOptional, IsUUID } from 'class-validator'
export class ConfigureHospitalReferralDto {
  @IsUUID() unitId: string
  @IsUUID() recipientCompanyId: string
  @IsUUID() recipientUnitId: string
  @IsOptional() @IsBoolean() active?: boolean
}
