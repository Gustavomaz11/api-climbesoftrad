import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator'

export class RegisterDto {
  @ApiProperty({ example: 'João da Silva', maxLength: 120 })
  @IsString()
  @Length(2, 120)
  fullName: string

  @ApiProperty({ example: 'joao@hospital.com.br', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email: string

  @ApiProperty({ example: 'uma senha longa e segura', minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string
}
