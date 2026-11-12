import {
  assertCompleteParts,
  uploadPartSize,
  expectedPartSize,
  assertUploadInput,
} from './upload.policy'

describe('Resumable uploads', () => {
  it('keeps fixed parts and allows a shorter last part', () => {
    expect(expectedPartSize(uploadPartSize + 13, 1)).toBe(uploadPartSize)
    expect(expectedPartSize(uploadPartSize + 13, 2)).toBe(13)
    expect(() => expectedPartSize(13, 2)).toThrow()
  })
  it('rejects missing, duplicated, truncated or oversized parts', () => {
    const parts = [
      { number: 1, size: uploadPartSize, etag: 'a' },
      { number: 2, size: 13, etag: 'b' },
    ]
    expect(assertCompleteParts(uploadPartSize + 13, parts)).toEqual(parts)
    for (const invalid of [
      parts.slice(1),
      [parts[0]!, parts[0]!],
      [{ ...parts[0]!, size: 1 }, parts[1]!],
    ])
      expect(() => assertCompleteParts(uploadPartSize + 13, invalid)).toThrow()
  })
  it('does not round, accept empty files, unsafe names or unbounded sizes', () => {
    expect(() =>
      assertUploadInput(
        { kind: 'ATTACHMENT', sizeBytes: 0, name: 'a.pdf', contentType: 'application/pdf' },
        100,
        200,
      ),
    ).toThrow()
    expect(() =>
      assertUploadInput(
        { kind: 'DICOM', sizeBytes: 201, name: 'a.dcm', contentType: 'application/dicom' },
        100,
        200,
      ),
    ).toThrow()
    expect(() =>
      assertUploadInput(
        { kind: 'DICOM', sizeBytes: 1.5, name: 'a.dcm', contentType: 'application/dicom' },
        100,
        200,
      ),
    ).toThrow()
  })
})
