import type { Redaction } from './research-ai.contracts'
export interface OcrWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

// Texture in anatomy can look like letters to OCR. Only automatically redact
// confident multi-character text surrounded by predominantly black background.
// Identifiers over anatomy still require the mandatory human privacy review.
export const backgroundTextMask = (
  word: OcrWord,
  pixels: Buffer,
  width: number,
  height: number,
): Redaction | null => {
  if (word.confidence < 80 || !/[A-ZÀ-ÖØ-öø-ÿ]{3,}|\d{4,}/i.test(word.text)) return null
  const b = word.bbox,
    h = b.y1 - b.y0
  if (h < 5 || h > height * 0.18 || b.x1 <= b.x0) return null
  const left = Math.max(0, Math.floor(b.x0 - h)),
    right = Math.min(width, Math.ceil(b.x1 + h))
  const top = Math.max(0, Math.floor(b.y0 - h)),
    bottom = Math.min(height, Math.ceil(b.y1 + h))
  let dark = 0,
    total = 0
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      total++
      if (pixels[y * width + x]! < 20) dark++
    }
  if (!total || dark / total < 0.65) return null
  let textDark = 0,
    textLight = 0,
    textTotal = 0
  for (let y = Math.max(0, Math.floor(b.y0)); y < Math.min(height, Math.ceil(b.y1)); y++)
    for (let x = Math.max(0, Math.floor(b.x0)); x < Math.min(width, Math.ceil(b.x1)); x++) {
      const value = pixels[y * width + x]!
      textTotal++
      if (value < 20) textDark++
      else if (value > 210) textLight++
    }
  if (
    !textTotal ||
    textDark / textTotal < 0.35 ||
    textLight / textTotal < 0.03 ||
    (textTotal - textDark - textLight) / textTotal > 0.45
  )
    return null
  const x = Math.max(0, b.x0 - 4),
    y = Math.max(0, b.y0 - 4)
  return {
    x: x / width,
    y: y / height,
    width: (Math.min(width, b.x1 + 4) - x) / width,
    height: (Math.min(height, b.y1 + 4) - y) / height,
  }
}
