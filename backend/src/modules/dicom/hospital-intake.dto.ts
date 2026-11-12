import { OmitType, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, Min, ValidateNested, IsDefined } from 'class-validator'
import { CreateExamDto } from '../exams/dto/create-exam.dto'

export class HospitalIntakeFieldsDto extends OmitType(CreateExamDto, [
  'unitId', 'patientId', 'sourceExamId', 'externalPatientId', 'externalEncounterId', 'originIssuer',
] as const) {}
class HospitalDraftFieldsDto extends PartialType(HospitalIntakeFieldsDto) {}
export class SaveHospitalIntakeDto {
  @IsInt() @Min(0) expectedVersion: number
  @IsDefined() @ValidateNested() @Type(() => HospitalDraftFieldsDto) fields: HospitalDraftFieldsDto
}
export class SubmitHospitalIntakeDto {
  @IsInt() @Min(0) expectedVersion: number
  @IsDefined() @ValidateNested() @Type(() => HospitalIntakeFieldsDto) fields: HospitalIntakeFieldsDto
}
