import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsString, Length, Matches, ValidateIf } from 'class-validator'

export class TokenRequestDto {
  @ApiProperty({ enum: ['authorization_code', 'refresh_token'] })
  @IsIn(['authorization_code', 'refresh_token'])
  grantType: 'authorization_code' | 'refresh_token'

  @ApiProperty({ example: 'crm-web' })
  @IsString()
  @Length(3, 100)
  clientId: string

  @ApiPropertyOptional()
  @ValidateIf((request: TokenRequestDto) => request.grantType === 'authorization_code')
  @IsString()
  @Length(43, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  authorizationCode?: string

  @ApiPropertyOptional()
  @ValidateIf((request: TokenRequestDto) => request.grantType === 'authorization_code')
  @IsString()
  @Length(43, 128)
  @Matches(/^[A-Za-z0-9._~-]+$/)
  codeVerifier?: string
}
