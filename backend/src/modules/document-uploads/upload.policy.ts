import { BadRequestException, ConflictException } from '@nestjs/common'
export const uploadPartSize = 8 * 1024 * 1024
export interface UploadedPart {
  number: number
  size: number
  etag: string
}
export const expectedPartSize = (total: number, number: number) => {
  if (!Number.isInteger(number) || number < 1 || number > Math.ceil(total / uploadPartSize))
    throw new BadRequestException('Número de parte inválido.')
  return Math.min(uploadPartSize, total - (number - 1) * uploadPartSize)
}
export const assertCompleteParts = (total: number, parts: UploadedPart[]) => {
  const sorted = [...parts].sort((a, b) => a.number - b.number)
  if (sorted.length !== Math.ceil(total / uploadPartSize))
    throw new ConflictException('O upload ainda possui partes ausentes.')
  sorted.forEach((part, index) => {
    if (
      part.number !== index + 1 ||
      part.size !== expectedPartSize(total, part.number) ||
      !part.etag
    )
      throw new ConflictException('Partes inválidas ou incompletas.')
  })
  return sorted
}
const documentTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
export const assertUploadInput = (
  input: { kind: string; sizeBytes: number; name: string; contentType: string },
  documentMax: number,
  dicomMax: number,
) => {
  const limit = input.kind === 'DICOM' ? dicomMax : documentMax
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > limit)
    throw new BadRequestException('Tamanho do arquivo excede o limite da classe.')
  if (
    !input.name.trim() ||
    /[\\/]/.test(input.name) ||
    [...input.name].some((character) => character.charCodeAt(0) < 32)
  )
    throw new BadRequestException('Nome de arquivo inválido.')
  if (
    input.kind === 'DICOM'
      ? input.contentType !== 'application/dicom'
      : !documentTypes.includes(input.contentType)
  )
    throw new BadRequestException('Formato de arquivo não permitido.')
}
