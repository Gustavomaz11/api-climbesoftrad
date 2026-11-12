import { Transform } from 'class-transformer'
import { IsBoolean, IsInt, IsString, IsUUID, Length, Min } from 'class-validator'
export class QualificationReasonDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 500)
  reason: string
}
export class CreatePhysicianQualificationDto extends QualificationReasonDto {
  @IsUUID() unitId: string
  @IsUUID() examTypeId: string
}
export class UpdatePhysicianQualificationDto extends QualificationReasonDto {
  @IsBoolean() active: boolean
  @IsInt() @Min(0) expectedVersion: number
}
