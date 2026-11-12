import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsString, Length } from 'class-validator'

export class AuthorizationCodeTokenDto {
  @ApiProperty({ enum: ['authorization_code'] })
  @IsIn(['authorization_code'])
  grantType: 'authorization_code'

  @ApiProperty({ example: 'crm-web' })
  @IsString()
  @Length(3, 100)
  clientId: string

  @ApiProperty({ example: 'authorization-code-base64url' })
  @IsString()
  @Length(43, 128)
  authorizationCode: string

  @ApiProperty({ example: 'pkce-code-verifier-base64url' })
  @IsString()
  @Length(43, 128)
  codeVerifier: string
}
