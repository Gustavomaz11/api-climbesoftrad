import sharp from 'sharp'
import { normalizePhysicianSignature } from './physician-signature-image'
import { syntheticSignature } from '../../../test/synthetic-signature'

describe('Signature image reconstruction', () => {
  it('fully decodes JPEG uploads and stores a bounded PNG without original metadata or trailing data', async () => {
    const marker = 'UNTRUSTED_SIGNATURE_METADATA'
    const jpeg = await sharp(await syntheticSignature()).withMetadata({ exif: { IFD0: { ImageDescription: marker } } }).jpeg().toBuffer()
    const result = await normalizePhysicianSignature(Buffer.concat([jpeg, Buffer.from(marker)]), 'image/jpeg')
    const metadata = await sharp(result).metadata()
    expect(metadata.format).toBe('png')
    expect(metadata.width).toBeLessThanOrEqual(1000); expect(metadata.height).toBeLessThanOrEqual(320)
    expect(result.length).toBeLessThanOrEqual(256 * 1024)
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.xmp).toBeUndefined()
    expect(result.includes(Buffer.from(marker))).toBe(false)
  })
  it('accepts black ink on a transparent background and rejects invisible or uniform images', async () => {
    const transparent = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><path d="M20 70 Q150 10 250 65 T380 65" stroke="black" fill="none" stroke-width="4"/></svg>')).png().toBuffer()
    await expect(normalizePhysicianSignature(transparent, 'image/png')).resolves.toBeInstanceOf(Buffer)
    for (const background of ['white', { r: 0, g: 0, b: 0, alpha: 0 }]) {
      const blank = await sharp({ create: { width: 200, height: 80, channels: 4, background } }).png().toBuffer()
      await expect(normalizePhysicianSignature(blank, 'image/png')).rejects.toThrow()
    }
  })
  it('rejects forged types, truncated input, unsupported formats, excessive size and excessive pixels', async () => {
    const png = await syntheticSignature()
    await expect(normalizePhysicianSignature(png, 'image/jpeg')).rejects.toThrow()
    await expect(normalizePhysicianSignature(png.subarray(0, 50), 'image/png')).rejects.toThrow()
    await expect(normalizePhysicianSignature(Buffer.from('<svg></svg>'), 'image/png')).rejects.toThrow()
    await expect(normalizePhysicianSignature(png, 'image/webp')).rejects.toThrow()
    await expect(normalizePhysicianSignature(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png')).rejects.toThrow('SIZE')
    const oversized = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: 'white' } }).png().toBuffer()
    await expect(normalizePhysicianSignature(oversized, 'image/png')).rejects.toThrow()
  })
  it('rejects PNG animation control chunks before decoding frames', async () => {
    const png = await syntheticSignature()
    const control = Buffer.alloc(20)
    control.writeUInt32BE(8, 0); control.write('acTL', 4); control.writeUInt32BE(2, 8)
    const animated = Buffer.concat([png.subarray(0, 33), control, png.subarray(33)])
    await expect(normalizePhysicianSignature(animated, 'image/png')).rejects.toThrow('ANIMATED_SIGNATURE')
  })
})
