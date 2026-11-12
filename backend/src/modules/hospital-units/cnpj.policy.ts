export const normalizeCnpj = (value: string) => value.replace(/[.\-/\s]/g, '').toUpperCase()
export const validCnpj = (value: string) => {
  const cnpj = normalizeCnpj(value)
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(.)\1+$/.test(cnpj)) return false
  const digit = (text: string) => {
    let weight = text.length - 7, sum = 0
    for (const char of text) { sum += (char.charCodeAt(0) - 48) * weight; weight = weight === 2 ? 9 : weight - 1 }
    return sum % 11 < 2 ? '0' : String(11 - sum % 11)
  }
  return digit(cnpj.slice(0, 12)) === cnpj[12] && digit(cnpj.slice(0, 13)) === cnpj[13]
}
