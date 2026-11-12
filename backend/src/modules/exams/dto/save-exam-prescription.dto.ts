import { IsObject, IsOptional, IsUUID } from 'class-validator'

export class SaveExamPrescriptionDto {
  @IsObject()
  content: Record<string, unknown>
  @IsOptional() @IsUUID() protocolSelectionId?: string
}
