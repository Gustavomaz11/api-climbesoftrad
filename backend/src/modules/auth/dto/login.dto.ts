import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator'

export class LoginDto {
  @ApiProperty({ example: 'usuario@hospital.com.br ou CRM/SP 123456' })
  @IsString()
  @Length(1, 254)
  @MaxLength(254)
  email: string

  @ApiProperty({ example: 'senha do usuário' })
  @IsString()
  @Length(1, 128)
  password: string

  @ApiProperty({ example: 'crm-web' })
  @IsString()
  @Length(3, 100)
  clientId: string

  @ApiProperty({ example: 'base64url-sha256-challenge' })
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]+$/)
  codeChallenge: string

  @ApiProperty({ enum: ['S256'], example: 'S256' })
  @IsIn(['S256'])
  codeChallengeMethod: 'S256'

  @ApiProperty({ example: 'estado-aleatorio-base64url' })
  @IsString()
  @Length(43, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  state: string

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  remember?: boolean
}
