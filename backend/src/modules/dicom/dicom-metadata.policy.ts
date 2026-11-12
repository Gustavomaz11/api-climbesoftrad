import { BadRequestException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { examModalities } from '../../database/entities/exam.entity'
import type { CreateExamDto } from '../exams/dto/create-exam.dto'
import { mapDicomStudyDetails } from './dicom-study-details.policy'
export interface DicomTags {
  studyUid: string
  seriesUid: string
  instanceUid: string
  sopClassUid: string
  patientId: string
  issuer: string
  patientName: string
  birthDate: string
  sex: string
  studyDate: string
  studyTime: string
  timezone: string
  modality: string
  description: string
  accessionNumber: string
  transferSyntax: string
  charset?: string
  patientSize?: string
  patientWeight?: string
  institutionName?: string
  referringPhysicianName?: string
  studyId?: string
}
export const stableStudyIdentity = (company: string, unit: string, uid: string) =>
  JSON.stringify(['dicom', company, unit, uid])
const dicomDate = (value: string) => {
  if (!/^\d{8}$/.test(value)) return null
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}
export const mapDicomMetadata = (tags: DicomTags) => {
  for (const uid of [
    tags.studyUid,
    tags.seriesUid,
    tags.instanceUid,
    tags.sopClassUid,
    tags.transferSyntax,
  ])
    if (uid.length > 64 || !/^\d+(\.\d+)+$/.test(uid))
      throw new BadRequestException('UID DICOM inválido ou ausente.')
  const issues: string[] = []
  const patientName = tags.patientName.replace(/\^/g, ' ').trim()
  const birthDate = dicomDate(tags.birthDate),
    studyDate = dicomDate(tags.studyDate)
  if (!patientName || patientName.length > 120) issues.push('Nome do paciente ausente ou extenso.')
  if (!birthDate) issues.push('Nascimento ausente ou inválido.')
  if (!['M', 'F'].includes(tags.sex)) issues.push('Sexo exige conferência cadastral.')
  if (!studyDate) issues.push('Data do estudo ausente ou inválida.')
  const validTime = /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d(?:\.\d{1,6})?$/.test(tags.studyTime)
  const validZone = /^[+-](?:0\d|1[0-3])[0-5]\d$/.test(tags.timezone)
  if (!validTime)
    issues.push('Horário do estudo ausente ou inválido.')
  if (!validZone)
    issues.push('Fuso do estudo ausente ou inválido.')
  if (!(examModalities as readonly string[]).includes(tags.modality))
    issues.push('Modalidade não reconhecida.')
  if (tags.charset && !['ISO_IR 192', 'ISO_IR 100', 'ISO_IR 6'].includes(tags.charset))
    issues.push('Codificação de texto exige conferência.')
  if (tags.patientId.length > 120 || tags.issuer.length > 64)
    issues.push('Identificador externo extenso.')
  const time = `${tags.studyTime.slice(0, 2)}:${tags.studyTime.slice(2, 4)}:${tags.studyTime.slice(4, 6)}${tags.studyTime.slice(6)}`
  const zone = `${tags.timezone.slice(0, 3)}:${tags.timezone.slice(3, 5)}`
  const dto: Partial<CreateExamDto> = {
    patientName,
    ...(birthDate ? { birthDate } : {}),
    ...(tags.sex === 'M' ? { sex: 'MASCULINO' } : tags.sex === 'F' ? { sex: 'FEMININO' } : {}),
    country: 'Brasil',
    studyDescription: (tags.description || tags.modality).slice(0, 180),
    modality: tags.modality,
    priority: 'ROTINA',
    ...(studyDate ? { studyDate } : {}),
    ...(validTime ? { studyTime: time } : {}),
    ...(studyDate && validTime && validZone ? { performedAt: `${studyDate}T${time}${zone}` } : {}),
    ...(tags.patientId ? { externalPatientId: tags.patientId } : {}),
    ...(tags.accessionNumber ? { accessionNumber: tags.accessionNumber.slice(0, 80) } : {}),
    ...mapDicomStudyDetails(tags, issues),
  }
  const identityHash = createHash('sha256')
    .update(
      JSON.stringify([
        tags.patientId,
        tags.issuer,
        patientName,
        birthDate,
        tags.sex,
        tags.studyDate,
      ]),
    )
    .digest('hex')
  return { dto, issues, identityHash }
}
