import { BadRequestException } from '@nestjs/common'
import { assertUploadedFileSignature } from './uploaded-file-security'

const uploadedFile = (mimetype: string, buffer: Buffer) =>
  ({ mimetype, buffer, originalname: 'arquivo' }) as Express.Multer.File

describe('assertUploadedFileSignature', () => {
  it('accepts a file whose signature matches the declared MIME type', () => {
    expect(() =>
      assertUploadedFileSignature(
        uploadedFile(
          'image/png',
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
      ),
    ).not.toThrow()
  })

  it('rejects active content disguised as an allowed file', () => {
    expect(() =>
      assertUploadedFileSignature(
        uploadedFile('image/png', Buffer.from('<script>alert(1)</script>')),
      ),
    ).toThrow(BadRequestException)
  })
})
