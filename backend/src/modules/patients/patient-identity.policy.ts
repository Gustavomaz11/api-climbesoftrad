export interface PatientDemographics {
  fullName: string
  birthDate?: string | null
  sex?: string | null
  socialName?: string | null
  country?: string
  email?: string | null
}
export const normalizePatientName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
export const demographicDifferences = (
  known: PatientDemographics,
  incoming: PatientDemographics,
) => {
  const differences: string[] = []
  if (normalizePatientName(known.fullName) !== normalizePatientName(incoming.fullName))
    differences.push('fullName')
  for (const field of ['birthDate', 'sex'] as const)
    if (known[field] && incoming[field] && known[field] !== incoming[field]) differences.push(field)
  return differences
}
export const explainCandidate = (
  incoming: PatientDemographics,
  candidate: PatientDemographics,
  similarity: number,
) => {
  const sameName =
    normalizePatientName(incoming.fullName) === normalizePatientName(candidate.fullName)
  const sameBirth = Boolean(incoming.birthDate && incoming.birthDate === candidate.birthDate)
  const incompatibleBirth = Boolean(
    incoming.birthDate && candidate.birthDate && incoming.birthDate !== candidate.birthDate,
  )
  const sameSex = Boolean(incoming.sex && incoming.sex === candidate.sex)
  const reasons = [
    sameName ? 'Nome normalizado igual' : 'Nome semelhante',
    ...(sameBirth ? ['Nascimento igual'] : []),
    ...(sameSex ? ['Sexo igual'] : []),
  ]
  const confidence =
    incompatibleBirth || !sameBirth
      ? 'LOW'
      : sameName && sameSex
        ? 'HIGH'
        : similarity >= 0.6
          ? 'MEDIUM'
          : 'LOW'
  return { confidence, reasons, automatic: false as const }
}
