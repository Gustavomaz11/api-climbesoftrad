import { BadRequestException } from '@nestjs/common'
export const externalPatientKey = (
  companyId: string,
  unitId: string,
  issuer: string | undefined,
  value: string | undefined,
) => {
  if (value === undefined) return null
  if (!issuer?.trim() || !value.trim())
    throw new BadRequestException('Identificador externo exige emissor e valor válidos.')
  return { companyId, unitId, issuer: issuer.trim(), originalValue: value }
}
