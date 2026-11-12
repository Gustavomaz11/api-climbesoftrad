export const loginUsernames = (identifier: string) => {
  const match = /^(\d+)\s*\/?\s*([a-z]{2})$/i.exec(identifier.trim())
  if (!match) return [identifier.trim()]
  const crm = match[1]!, uf = match[2]!.toUpperCase()
  return [...new Set([identifier.trim(), crm + uf, `${crm}/${uf}`, `CRM/${uf} ${crm}`])]
}
