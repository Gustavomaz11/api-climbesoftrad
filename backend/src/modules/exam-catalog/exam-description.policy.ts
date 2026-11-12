export const normalizeExamDescription = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
export interface DescriptionMapping {
  examTypeId: string
  version: number
  specificity: number
  id?: string
}
export const chooseDescriptionMapping = (mappings: DescriptionMapping[]) => {
  if (!mappings.length)
    return { status: 'UNKNOWN' as const, examTypeId: null, ruleVersion: null, aliasId: null }
  const best = Math.max(...mappings.map((item) => item.specificity))
  const selected = mappings.filter((item) => item.specificity === best)
  if (new Set(selected.map((item) => item.examTypeId)).size !== 1)
    return { status: 'AMBIGUOUS' as const, examTypeId: null, ruleVersion: null, aliasId: null }
  const chosen = selected.sort((a, b) => b.version - a.version)[0]!
  return {
    status: 'APPROVED' as const,
    examTypeId: chosen.examTypeId,
    ruleVersion: chosen.version,
    ...(chosen.id ? { aliasId: chosen.id } : {}),
  }
}
