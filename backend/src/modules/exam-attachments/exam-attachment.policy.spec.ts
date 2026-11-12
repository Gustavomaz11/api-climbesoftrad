import { BadRequestException } from '@nestjs/common'
import { validateExamAttachment } from './exam-attachment.policy'

const file = (body: Buffer, mimetype = 'application/pdf') =>
  ({
    buffer: body,
    size: body.length,
    mimetype,
    originalname: '../pedido.pdf',
  }) as Express.Multer.File

describe('Classified exam attachment validation', () => {
  it('preserves a safe name and computes the hash of the exact received content', () => {
    const result = validateExamAttachment(file(Buffer.from('%PDF-1.7\nfixture')))
    expect(result.name).toBe('pedido.pdf')
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.extension).toBe('pdf')
  })
  it('rejects empty, disguised, unsupported and oversized files before storage', () => {
    for (const upload of [
      file(Buffer.alloc(0)),
      file(Buffer.from('<script>invalid</script>')),
      file(Buffer.from('plain text'), 'text/plain'),
      file(Buffer.alloc(10 * 1024 * 1024 + 1)),
    ])
      expect(() => validateExamAttachment(upload)).toThrow(BadRequestException)
  })
  it('rejects a size different from the received content', () => {
    const upload = file(Buffer.from('%PDF-1.7\nfixture'))
    upload.size += 1
    expect(() => validateExamAttachment(upload)).toThrow(BadRequestException)
  })
})
