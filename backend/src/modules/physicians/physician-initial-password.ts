// New registry registrations use NUMBER/UF. Keep the former CRM/UF NUMBER
// format readable for existing API clients without changing their login name.
export const physicianInitialPassword = (crm: string): string => {
  const normalized = crm.trim().toUpperCase()
  const canonical = /^(\d+)\s*\/\s*([A-Z]{2})$/.exec(normalized)
  if (canonical) return canonical[1]! + canonical[2]!
  const legacy = /^CRM\s*\/\s*([A-Z]{2})\s+(\d+)$/.exec(normalized)
  if (legacy) return legacy[2]! + legacy[1]!
  return normalized.replace(/[^A-Z0-9]/g, '')
}
