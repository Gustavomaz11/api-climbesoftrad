import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class AssignUserRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roleId: string
}
