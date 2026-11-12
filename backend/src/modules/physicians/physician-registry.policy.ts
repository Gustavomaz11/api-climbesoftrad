export const brazilStates = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'] as const
export interface MedicalRegistration { crm: string; uf: string; status: string; enabled: boolean }
export interface PhysicianRegistryProfile {
  name: string; registrations: MedicalRegistration[]; specialties: string[]
  institution: string | null; graduationYear: string | null; consultedAt: string
}
const regular = (status: string) => ['regular', 'ativo', 'ativa'].includes(status.trim().toLowerCase())

// Never infer authorization from the mere presence of a state in free text.
export const normalizeRegistryDoctor = (doctor: Record<string, unknown>, crm: string, uf: string): PhysicianRegistryProfile => {
  if (typeof doctor.nomeEntidade !== 'string' || doctor.nomeEntidade.trim().length < 2
    || String(doctor.crm).replace(/\s/g, '') !== `${crm}/${uf}` || doctor.uf !== uf)
    throw new Error('Inconsistent registry result')
  const status = typeof doctor.situacao === 'string' ? doctor.situacao : 'Não informada'
  const registrations: MedicalRegistration[] = [{ crm, uf, status, enabled: regular(status) }]
  const others = typeof doctor.inscricaoOutrosEstados === 'string' ? doctor.inscricaoOutrosEstados : ''
  for (const match of others.matchAll(/\b([A-Z]{2})\s*\/\s*(\d+)\s*\(([^)]+)\)/g)) {
    if (!match[1] || !match[2] || !match[3]) continue
    if (!(brazilStates as readonly string[]).includes(match[1])) continue
    const registration = { crm: match[2], uf: match[1], status: match[3].trim(), enabled: regular(match[3]) }
    if (!registrations.some(item => item.crm === registration.crm && item.uf === registration.uf)) registrations.push(registration)
  }
  return {
    name: doctor.nomeEntidade.trim().slice(0, 120), registrations,
    specialties: Array.isArray(doctor.especialidades)
      ? doctor.especialidades.filter((item): item is string => typeof item === 'string').map(item => item.slice(0, 180)).slice(0, 100) : [],
    institution: typeof doctor.instituicaoGraduacao === 'string' ? doctor.instituicaoGraduacao.slice(0, 250) : null,
    graduationYear: typeof doctor.anoFormatura === 'string' ? doctor.anoFormatura.slice(0, 4) : null,
    consultedAt: new Date().toISOString(),
  }
}

export const registryAllowsState = (profile: PhysicianRegistryProfile | null | undefined, uf?: string | null) =>
  !profile || profile.registrations.some(registration => registration.enabled && (!uf || registration.uf === uf))

export const registeredCrmForState = (profile: PhysicianRegistryProfile | null | undefined, uf: string | null, fallback: string) => {
  if (!profile) return fallback
  const registration = profile.registrations.find(item=>item.enabled && (!uf || item.uf===uf))
  if (!registration) throw new Error('No regular CRM for state')
  return `${registration.crm}/${registration.uf}`
}
