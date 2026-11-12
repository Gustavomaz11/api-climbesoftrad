import { Transform } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayUnique, IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator'

export class UpdateAccessRoleDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @ApiProperty({ example: 'Faturamento' })
  @IsString()
  @Length(2, 120)
  name: string

  @ApiPropertyOptional({ example: 'Acesso operacional do setor de faturamento.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string

  @ApiProperty({ type: [String], example: ['exams.view', 'attachments.view'] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionCodes: string[]
}
