import sharp from 'sharp'

const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const rejectAnimatedPng = (source: Buffer) => {
  let offset = pngHeader.length
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset)
    if (length > source.length - offset - 12) throw new Error('INVALID_SIGNATURE')
    const type = source.toString('ascii', offset + 4, offset + 8)
    if (type === 'acTL') throw new Error('ANIMATED_SIGNATURE')
    if (type === 'IEND') return
    offset += length + 12
  }
}

// Only newly encoded pixels are stored. Original files, metadata and trailing data are discarded.
export const normalizePhysicianSignature = async (source: Buffer, contentType: string) => {
  if (!source.length || source.length > 2 * 1024 * 1024) throw new Error('INVALID_SIGNATURE_SIZE')
  const expected = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpeg' : null
  if (!expected) throw new Error('INVALID_SIGNATURE_TYPE')
  if (expected === 'png') {
    if (!source.subarray(0, 8).equals(pngHeader)) throw new Error('INVALID_SIGNATURE')
    rejectAnimatedPng(source)
  } else if (!source.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) throw new Error('INVALID_SIGNATURE')

  const image = sharp(source, { animated: true, failOn: 'warning', limitInputPixels: 16_000_000 })
  const meta = await image.metadata()
  if ((meta.pages ?? 1) !== 1 || meta.format !== expected) throw new Error('INVALID_SIGNATURE')
  const pixels = await image.rotate().flatten({ background: '#ffffff' }).toColourspace('srgb').removeAlpha()
    .trim({ threshold: 10 }).resize({ width: 1000, height: 320, fit: 'inside', withoutEnlargement: true })
    .timeout({ seconds: 5 }).raw().toBuffer({ resolveWithObject: true })
  const raw = { width: pixels.info.width, height: pixels.info.height, channels: 3 as const }
  if (pixels.info.channels !== 3) throw new Error('INVALID_SIGNATURE')
  const stats = await sharp(pixels.data, { raw }).stats()
  if (!stats.channels.some(channel => channel.stdev > 1)) throw new Error('EMPTY_SIGNATURE')
  const png = await sharp(pixels.data, { raw }).png().timeout({ seconds: 5 }).toBuffer()
  if (png.length > 256 * 1024) throw new Error('SIGNATURE_TOO_LARGE')
  return png
}
