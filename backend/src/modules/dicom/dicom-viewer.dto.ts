import { IsOptional, IsUUID } from 'class-validator'
export class CreateDicomViewerDto {
  @IsOptional() @IsUUID() previousExamId?: string
}
