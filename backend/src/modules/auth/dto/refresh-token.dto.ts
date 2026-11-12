import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsString, Length } from 'class-validator'

export class RefreshTokenDto {
  @ApiProperty({ enum: ['refresh_token'] })
  @IsIn(['refresh_token'])
  grantType: 'refresh_token'

  @ApiProperty({ example: 'crm-web' })
  @IsString()
  @Length(3, 100)
  clientId: string
}
