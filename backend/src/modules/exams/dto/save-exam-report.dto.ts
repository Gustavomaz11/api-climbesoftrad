import { ApiProperty } from '@nestjs/swagger'
import { IsObject, IsUUID } from 'class-validator'

export class SaveExamReportDto {
  @IsUUID() clientId: string
  @ApiProperty({ description: 'Documento TipTap/ProseMirror serializado em JSON' })
  @IsObject()
  content: Record<string, unknown>
}
