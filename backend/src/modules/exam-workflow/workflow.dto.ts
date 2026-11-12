import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { examPriorities, type ExamPriority } from '../../database/entities/exam.entity'
import { preparationItems, type PreparationItem } from './workflow.contracts'

export class VersionedWorkflowDto {
  @IsInt() @Min(1) expectedVersion: number
  @IsString() @MinLength(3) @MaxLength(500) reason: string
}
export class PreparationPolicyDto {
  @IsUUID() unitId: string
  @IsOptional() @IsUUID() examTypeId?: string
  @IsInt() @Min(0) expectedVersion: number
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(preparationItems, { each: true })
  requiredItems: PreparationItem[]
  @IsString() @MinLength(3) @MaxLength(500) reason: string
}
export class PreparationCheckItemDto {
  @IsIn(preparationItems) item: PreparationItem
  @IsBoolean() confirmed: boolean
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) exceptionReason?: string
}
export class PreparationCheckDto extends VersionedWorkflowDto {
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PreparationCheckItemDto)
  items: PreparationCheckItemDto[]
}
export class OperationalFieldsDto extends VersionedWorkflowDto {
  @IsOptional() @IsString() @MaxLength(120) requesterName?: string
  @IsOptional() @IsString() @MaxLength(140) requesterReference?: string
  @IsOptional() @IsString() @MaxLength(120) performingPhysician?: string
  @IsOptional() @IsString() @MaxLength(100) healthInsurance?: string
}
export class PriorityChangeDto extends VersionedWorkflowDto {
  @IsIn(examPriorities) priority: ExamPriority
}
export class OpenWorkflowIssueDto extends VersionedWorkflowDto {
  @IsIn(['PENDING', 'RECALL']) kind: 'PENDING' | 'RECALL'
  @IsIn(['DOCUMENT', 'IMAGES', 'IDENTITY', 'CLASSIFICATION', 'OTHER']) category: string
  @IsOptional() @IsIn(['ACQUISITION', 'DOCUMENTS']) requestedAction?: 'ACQUISITION' | 'DOCUMENTS'
  @IsOptional() @IsUUID() responsibleUserId?: string
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  attachmentIds?: string[]
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  commentIds?: string[]
}
export class ResolveWorkflowIssueDto extends VersionedWorkflowDto {
  @IsOptional() @IsBoolean() acquisitionConfirmed?: boolean
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  studyIds?: string[]
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  attachmentIds?: string[]
  @IsOptional() @IsUUID() complementExamId?: string
}
