import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
export class ContrastFieldDto {
  @IsString() @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,29}$/) key: string
  @IsString() @Length(1, 120) label: string
  @IsIn(['TEXT', 'NUMBER']) kind: 'TEXT' | 'NUMBER'
  @IsString() @MaxLength(30) unit: string
  @IsBoolean() required: boolean
}
export class CreateContrastProtocolDto {
  @IsUUID() examTypeId: string
  @IsOptional() @IsUUID() unitId?: string
  @IsString() @Length(2, 180) name: string
  @IsString() @Length(1, 10000) template: string
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ContrastFieldDto)
  fields: ContrastFieldDto[]
  @IsString() @MaxLength(2000) notes: string
  @IsOptional() @IsUUID() previousId?: string
}
export class ActivateContrastProtocolDto {
  @IsInt() @Min(0) expectedStateVersion: number
  @IsUUID() approvedByPhysicianId: string
  @IsString() @Length(3, 500) approvalReference: string
}
export class RetireContrastProtocolDto {
  @IsInt() @Min(0) expectedStateVersion: number
  @IsString() @Length(3, 500) reason: string
}
export class SelectContrastProtocolDto {
  @IsUUID() protocolId: string
  @IsObject() values: Record<string, unknown>
  @IsString() @MaxLength(2000) observations: string
}
