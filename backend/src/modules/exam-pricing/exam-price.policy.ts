import { BadRequestException, ConflictException } from '@nestjs/common'
export const amountToCents = (input: string) => {
  if (!/^(?:0|[1-9]\d{0,8})(?:[.,]\d{1,2})?$/.test(input))
    throw new BadRequestException('Informe valor não negativo com até duas casas decimais.')
  const [whole, fraction = ''] = input.replace(',', '.').split('.')
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))).toString()
}
interface EffectivePrice {
  id: string
  unitId: string | null
  physicianId: string | null
  validFrom: string
  validTo: string | null
}
export const choosePriceRule = <T extends EffectivePrice>(
  rules: T[],
  unitId: string,
  physicianId: string | null,
  date: string,
): T | null => {
  const matches = rules.filter(
    (rule) =>
      (!rule.unitId || rule.unitId === unitId) &&
      (!rule.physicianId || rule.physicianId === physicianId) &&
      rule.validFrom <= date &&
      (!rule.validTo || rule.validTo >= date),
  )
  const score = (rule: T) => (rule.physicianId ? 2 : 0) + (rule.unitId ? 1 : 0)
  matches.sort((left, right) => score(right) - score(left))
  if (matches[0] && matches[1] && score(matches[0]) === score(matches[1]))
    throw new ConflictException('Regras de preço ambíguas. Revise as vigências.')
  return matches[0] ?? null
}
