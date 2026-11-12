import { ApiProperty } from '@nestjs/swagger'
import { IsObject } from 'class-validator'

export class SaveExamReportDto {
  @ApiProperty({ description: 'Documento TipTap/ProseMirror serializado em JSON' })
  @IsObject()
  content: Record<string, unknown>
}
