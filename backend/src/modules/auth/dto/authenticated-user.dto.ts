import { ApiProperty } from '@nestjs/swagger'
import type { CompanyAccessSummary } from '../../companies/company-context.contracts'

export class AuthenticatedUserDto {
  @ApiProperty({ format: 'uuid' }) centralCompanyId: string
  @ApiProperty({ format: 'uuid' })
  id: string

  @ApiProperty()
  email: string

  @ApiProperty({ nullable: true })
  username: string | null

  @ApiProperty()
  fullName: string

  @ApiProperty({ enum: ['USER', 'ADMIN', 'DOCTOR'] })
  role: 'USER' | 'ADMIN' | 'DOCTOR'

  @ApiProperty()
  mustChangePassword: boolean
  @ApiProperty() mustUploadSignature: boolean

  @ApiProperty()
  isPlatformAdmin: boolean

  @ApiProperty()
  accessRole: { id: string; code: string; name: string }

  @ApiProperty({ type: [String] })
  permissions: string[]

  @ApiProperty({ type: [Object] })
  companies: CompanyAccessSummary[]

  @ApiProperty({ nullable: true })
  activeCompany: {
    id: string
    name: string
    membershipId: string | null
    allUnits: boolean
    unitIds: string[]
    selectedUnitId: string | null
  } | null
}
