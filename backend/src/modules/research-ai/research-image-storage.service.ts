import { Injectable } from '@nestjs/common'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { R2ObjectStorage } from '../exams/r2-object-storage.service'
import { R2MultipartStorage } from '../file-validation/r2-multipart-storage.service'
import type { Redaction } from './research-ai.contracts'

export const redactResearchPng = async (png: Buffer, masks: Redaction[]) => {
  const metadata = await sharp(png, { limitInputPixels: 64000000 }).metadata()
  const width = metadata.width,
    height = metadata.height
  const rectangles = masks
    .map(
      (mask) =>
        `<rect x="${Math.floor(mask.x * width)}" y="${Math.floor(mask.y * height)}" width="${Math.ceil((mask.x + mask.width) * width) - Math.floor(mask.x * width)}" height="${Math.ceil((mask.y + mask.height) * height) - Math.floor(mask.y * height)}" fill="black"/>`,
    )
    .join('')
  return sharp(png)
    .composite([
      { input: Buffer.from(`<svg width="${width}" height="${height}">${rectangles}</svg>`) },
    ])
    .png()
    .toBuffer()
}

@Injectable()
export class ResearchImageStorage {
  constructor(
    private readonly objects: R2ObjectStorage,
    private readonly multipart: R2MultipartStorage,
  ) {}
  async read(key: string) {
    const stream = await this.multipart.stream(key),
      chunks: Buffer[] = []
    let size = 0
    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        size += chunk.length
        if (size > 32 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE')
        chunks.push(chunk)
      }
    } finally {
      stream.destroy()
    }
    return Buffer.concat(chunks)
  }
  async put(key: string, png: Buffer) {
    const sha256 = createHash('sha256').update(png).digest('hex')
    await this.objects.put(key, {
      body: png,
      contentType: 'image/png',
      cacheControl: 'private, no-store',
      metadata: { sha256 },
    })
    return sha256
  }
}
