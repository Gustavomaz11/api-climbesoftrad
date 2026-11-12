import { BadRequestException } from '@nestjs/common'

const startsWith = (buffer: Buffer, signature: number[]): boolean =>
  signature.every((byte, index) => buffer[index] === byte)

const isJpeg = (buffer: Buffer) => startsWith(buffer, [0xff, 0xd8, 0xff])
const isPng = (buffer: Buffer) =>
  startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const isGif = (buffer: Buffer) => {
  const header = buffer.subarray(0, 6).toString('ascii')
  return header === 'GIF87a' || header === 'GIF89a'
}
const isWebp = (buffer: Buffer) =>
  buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
  buffer.subarray(8, 12).toString('ascii') === 'WEBP'
const isPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-'
const isZip = (buffer: Buffer) =>
  startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
  startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
  startsWith(buffer, [0x50, 0x4b, 0x07, 0x08])
const isOle = (buffer: Buffer) =>
  startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const isUtf8Text = (buffer: Buffer) => {
  if (buffer.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

const validators: Record<string, (buffer: Buffer) => boolean> = {
  'image/jpeg': isJpeg,
  'image/png': isPng,
  'image/gif': isGif,
  'image/webp': isWebp,
  'application/pdf': isPdf,
  'application/msword': isOle,
  'application/vnd.ms-excel': isOle,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isZip,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': isZip,
  'text/plain': isUtf8Text,
}

export const assertUploadedFileSignature = (file: Express.Multer.File): void => {
  const validates = validators[file.mimetype]
  if (!validates || file.buffer.length === 0 || !validates(file.buffer)) {
    throw new BadRequestException(`O conteÃºdo do arquivo ${file.originalname} nÃ£o corresponde ao formato informado.`)
  }
}
