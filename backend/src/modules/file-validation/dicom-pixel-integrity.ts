import type { DataSet } from 'dicom-parser'
import type { FileHandle } from 'node:fs/promises'
// Check native length and encapsulated fragment boundaries without buffering pixel payloads.
export const assertDicomPixelIntegrity = async (
  file: FileHandle,
  data: DataSet,
  totalSize: number,
) => {
  const pixel = data.elements.x7fe00010
  if (!pixel) return // Non-image DICOM objects can omit Pixel Data.
  const bigEndian = data.string('x00020010') === '1.2.840.10008.1.2.2'
  if (pixel.length !== 0xffffffff) {
    if (pixel.length < 1 || pixel.dataOffset + pixel.length > totalSize)
      throw new Error('Pixel Data truncado.')
    const rows = data.uint16('x00280010'),
      columns = data.uint16('x00280011'),
      bits = data.uint16('x00280100'),
      samples = data.uint16('x00280002') ?? 1,
      frames = data.intString('x00280008') ?? 1
    if (
      rows &&
      columns &&
      bits &&
      Math.ceil((rows * columns * samples * bits * frames) / 8) > pixel.length
    )
      throw new Error('Comprimento de pixels inconsistente.')
    return
  }
  let offset = pixel.dataOffset,
    fragments = 0
  const header = Buffer.alloc(8)
  while (offset + 8 <= totalSize) {
    if (++fragments > 1000000) throw new Error('Número de fragmentos excessivo.')
    if ((await file.read(header, 0, 8, offset)).bytesRead !== 8)
      throw new Error('Fragmento truncado.')
    const group = bigEndian ? header.readUInt16BE(0) : header.readUInt16LE(0),
      element = bigEndian ? header.readUInt16BE(2) : header.readUInt16LE(2),
      length = bigEndian ? header.readUInt32BE(4) : header.readUInt32LE(4)
    if (group === 0xfffe && element === 0xe0dd && length === 0) return
    if (
      group !== 0xfffe ||
      element !== 0xe000 ||
      length === 0xffffffff ||
      offset + 8 + length > totalSize
    )
      throw new Error('Fragmento DICOM inválido.')
    offset += 8 + length
  }
  throw new Error('Pixel Data encapsulado incompleto.')
}
