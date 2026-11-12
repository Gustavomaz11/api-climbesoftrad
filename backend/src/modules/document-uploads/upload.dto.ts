import {
  IsIn,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import type { ExamAttachmentCategory } from '../../database/entities/exam-attachment.entity'
export class CreateUploadDto {
  @IsOptional() @IsUUID() deliveryId?: string
  @IsOptional() @IsUUID() deliveryFileId?: string
  @IsOptional() @IsInt() @Min(1) @Max(10000) deliveryTotal?: number
  @IsOptional() @IsBoolean() hospitalIntake?: boolean
  @IsIn(['ATTACHMENT', 'DICOM']) kind: 'ATTACHMENT' | 'DICOM'
  @IsUUID() unitId: string
  @IsOptional() @IsUUID() examId?: string
  @IsOptional() @IsUUID() sourceId?: string
  @IsString() @MaxLength(255) name: string
  @IsString() @MaxLength(120) contentType: string
  @IsInt() @Min(1) @Max(2147483647) sizeBytes: number
  @Matches(/^[a-f0-9]{64}$/) sha256: string
  @IsOptional() @IsIn(['ORDER', 'QUESTIONNAIRE', 'COMPARATIVE']) category?: ExamAttachmentCategory
  @IsOptional() @IsUUID() replacesId?: string
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number
  @IsOptional() @IsString() @MaxLength(500) reason?: string
}
