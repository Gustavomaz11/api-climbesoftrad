import type { CreateExamDto } from '../exams/dto/create-exam.dto'
import type { DicomTags } from './dicom-metadata.policy'

export const dicomStudyDetailFields = ['heightMeters', 'weightKg', 'studyDate', 'studyTime', 'institutionName', 'requesterName', 'studyId'] as const

export const mapDicomStudyDetails = (tags: DicomTags, issues: string[]): Partial<CreateExamDto> => {
  const measurement = (value: string | undefined, label: string, max: number) => {
    if (!value?.trim()) return undefined
    const raw = value.trim(), number = Number(raw)
    if (number === 0) return undefined
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(number) || number < 0 || number > max) {
      issues.push(`${label} do paciente inválid${label === 'Altura' ? 'a' : 'o'}.`)
      return undefined
    }
    return number
  }
  const text = (value: string | undefined, limit: number, label: string) => {
    if (!value?.trim()) return undefined
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (normalized.length > limit) issues.push(`${label} extenso: confira o valor recebido.`)
    return normalized.slice(0, limit)
  }
  const personName = (value?: string) => {
    if (!value?.includes('^')) return value
    const [family, given, middle, prefix, suffix] = value.split('=')[0]!.split('^')
    return [prefix, given, middle, family, suffix].filter(Boolean).join(' ')
  }
  const heightMeters = measurement(tags.patientSize, 'Altura', 10)
  const weightKg = measurement(tags.patientWeight, 'Peso', 10000)
  const institutionName = text(tags.institutionName, 120, 'Instituição')
  const requesterName = text(personName(tags.referringPhysicianName), 120, 'Nome do solicitante')
  const studyId = text(tags.studyId, 64, 'Identificador do estudo')
  return {
    ...(heightMeters === undefined ? {} : { heightMeters }),
    ...(weightKg === undefined ? {} : { weightKg }),
    ...(institutionName === undefined ? {} : { institutionName }),
    ...(requesterName === undefined ? {} : { requesterName }),
    ...(studyId === undefined ? {} : { studyId }),
  }
}
