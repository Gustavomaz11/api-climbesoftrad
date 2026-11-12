import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { workflowStates, type WorkflowState } from '../../exam-workflow/workflow.contracts'

export class ListExamsQueryDto {
  @IsOptional() @IsIn(workflowStates) workflowState?: WorkflowState
  @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED', 'ALL', 'PREPARATION', 'HISTORY']) queue?:
    'ACTIVE' | 'ARCHIVED' | 'ALL' | 'PREPARATION' | 'HISTORY'
  @ApiPropertyOptional({ enum: [7, 15, 30] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 15, 30])
  periodDays?: 7 | 15 | 30

  @ApiPropertyOptional({ example: '2026-08-23' })
  @IsOptional()
  @IsDateString({ strict: true })
  examDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  patientName?: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 10
}
