import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class CreateExamCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string

  @IsOptional()
  @IsUUID()
  parentCommentId?: string
}
