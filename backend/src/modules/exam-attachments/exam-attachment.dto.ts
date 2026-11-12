import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator'
import {
  examAttachmentCategories,
  type ExamAttachmentCategory,
} from '../../database/entities/exam-attachment.entity'

export class UploadExamAttachmentDto {
  @IsIn(examAttachmentCategories) category: ExamAttachmentCategory
  @IsOptional() @IsUUID() replacesId?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expectedVersion?: number
  @IsOptional() @IsString() @MaxLength(500) reason?: string
}
