import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { CreateExamDto } from '../exams/dto/create-exam.dto'
export class CompleteDicomStudyDto {
  @IsString() @Matches(/\S/) @MaxLength(100) reason: string
}
export class ResolveDicomReviewDto {
  @IsInt() @Min(0) expectedVersion: number
  @IsIn(['ACKNOWLEDGE', 'CORRECT']) action: 'ACKNOWLEDGE' | 'CORRECT'
  @IsString() @Matches(/\S/) @MaxLength(500) reason: string
  @IsOptional() @ValidateNested() @Type(() => CreateExamDto) exam?: CreateExamDto
}
