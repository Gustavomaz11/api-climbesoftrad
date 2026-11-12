import { BadRequestException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { assertUploadedFileSignature } from '../exams/uploaded-file-security'

export const examAttachmentMaxBytes = 10 * 1024 * 1024
const extensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const validateExamAttachment = (file: Express.Multer.File) => {
  const extension = extensions[file.mimetype]
  if (!extension || file.size > examAttachmentMaxBytes || file.size !== file.buffer.length)
    throw new BadRequestException('Envie um PDF ou imagem de até 10 MB.')
  assertUploadedFileSignature(file)
  const basename = file.originalname.split(/[\\/]/).at(-1) ?? ''
  const name = Array.from(basename)
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .trim()
  if (!name) throw new BadRequestException('Informe um nome de arquivo válido.')
  return {
    name: name.slice(0, 255),
    extension,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  }
}
