import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { createWorker, OEM, type Worker } from 'tesseract.js'
import { dirname, join } from 'node:path'
import type { Redaction } from './research-ai.contracts'
import sharp from 'sharp'
import { backgroundTextMask } from './background-text-redaction'

@Injectable()
export class LocalTextRedactionService implements OnModuleDestroy {
  private worker: Promise<Worker> | null = null
  async detect(png: Buffer, width: number, height: number): Promise<Redaction[]> {
    this.worker ??= createWorker('eng', OEM.LSTM_ONLY, {
      langPath: join(dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0'),
      gzip: true,
      cacheMethod: 'none',
      logger: () => {},
      errorHandler: () => {},
    })
    try {
      const worker = await this.worker
      const { data } = await worker.recognize(png, {}, { blocks: true, text: false })
      const words = (data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)),
      )
      const pixels = await sharp(png).greyscale().removeAlpha().raw().toBuffer()
      const masks: Redaction[] = []
      for (const word of words) {
        const mask = backgroundTextMask(word, pixels, width, height)
        if (mask) masks.push(mask)
      }
      return masks.slice(0, 1000)
    } catch {
      throw new Error('LOCAL_OCR_FAILED')
    }
  }
  async onModuleDestroy() {
    if (this.worker) await this.worker.then((worker) => worker.terminate()).catch(() => {})
  }
}
