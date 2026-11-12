import sharp from 'sharp'
import { ConfigService } from '@nestjs/config'
import { GeminiResearchClient } from './gemini-research.client'
import { validateResearchResult } from './research-ai.contracts'
import { LocalTextRedactionService } from './local-text-redaction.service'
import { redactResearchPng } from './research-image-storage.service'
import { backgroundTextMask } from './background-text-redaction'
const result = {
  summary: 'Formas sintéticas',
  limitations: [],
  imagesReviewed: ['image-1'],
  imageAssessments: [
    {
      imageId: 'image-1',
      localizationStatus: 'LOCALIZED',
      description: 'Forma visual localizada nesta imagem.',
    },
  ],
  findings: [
    { imageId: 'image-1', label: 'Forma', description: 'Contraste', box: [10, 20, 50, 60] },
  ],
}
describe('Research response validation', () => {
  it('requires an individual assessment for every image in the new protocol', () => {
    expect(() =>
      validateResearchResult({ ...result, imageAssessments: [] }, ['image-1'], true),
    ).toThrow('COVERAGE_INCOMPLETE')
    expect(() =>
      validateResearchResult(
        {
          ...result,
          imageAssessments: [
            { imageId: 'foreign', localizationStatus: 'LOCALIZED', description: 'Texto' },
          ],
        },
        ['image-1'],
        true,
      ),
    ).toThrow('RESULT_INVALID')
  })
  it('accepts an honest lack of localization without fabricating a region', () => {
    const assessment = {
      imageId: 'image-1',
      localizationStatus: 'NO_LOCALIZATION',
      description: 'Não foi possível delimitar uma região nesta imagem.',
    }
    expect(
      validateResearchResult(
        { ...result, findings: [], imageAssessments: [assessment] },
        ['image-1'],
        true,
      ).findings,
    ).toEqual([])
    expect(() =>
      validateResearchResult({ ...result, imageAssessments: [assessment] }, ['image-1'], true),
    ).toThrow('RESULT_INVALID')
    expect(() => validateResearchResult({ ...result, findings: [] }, ['image-1'], true)).toThrow(
      'RESULT_INVALID',
    )
  })
  it('requires exact image coverage', () => {
    expect(() => validateResearchResult(result, ['image-1', 'image-2'])).toThrow(
      'COVERAGE_INCOMPLETE',
    )
    expect(() =>
      validateResearchResult({ ...result, imagesReviewed: ['image-1', 'image-1'] }, [
        'image-1',
        'image-2',
      ]),
    ).toThrow('COVERAGE_INCOMPLETE')
  })
  it.each([
    [0, 0, 1001, 200],
    [500, 0, 200, 300],
    [0, 900, 300, 400],
    [0, 0, NaN, 100],
  ])('rejects invalid coordinates %j', (...box) => {
    expect(() =>
      validateResearchResult({ ...result, findings: [{ ...result.findings[0], box }] }, [
        'image-1',
      ]),
    ).toThrow('RESULT_INVALID')
  })
  it('rejects regions associated with another exam', () =>
    expect(() =>
      validateResearchResult(
        { ...result, findings: [{ ...result.findings[0], imageId: 'foreign' }] },
        ['image-1'],
      ),
    ).toThrow('RESULT_INVALID'))
})
describe('Gemini transport', () => {
  const original = global.fetch
  afterEach(() => {
    global.fetch = original
  })
  it('uses only pseudonymous image IDs and stripped PNGs, with key in header', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'black' } })
      .png()
      .toBuffer()
    const fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } },
          ],
        }),
      ),
    )
    global.fetch = fetch
    const client = new GeminiResearchClient(
      new ConfigService({
        GEMINI_RESEARCH_ENABLED: true,
        GEMINI_API_KEY: 'private-test-key',
        GEMINI_RESEARCH_MODEL: 'gemini-3.5-flash-lite',
      }),
    )
    await client.analyze([{ id: 'image-1', png }])
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('private-test-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('private-test-key')
    expect(init.body).not.toContain('PatientName')
    expect(init.body).toContain('image/png')
  })
  it('does not expose provider errors or accept truncated responses', async () => {
    const client = new GeminiResearchClient(
      new ConfigService({ GEMINI_RESEARCH_ENABLED: true, GEMINI_API_KEY: 'secret' }),
    )
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('secret upstream body', { status: 403 }))
    await expect(client.analyze([])).rejects.toThrow('GEMINI_ACCESS_DENIED')
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] })),
      )
    await expect(client.analyze([])).rejects.toThrow('RESULT_INCOMPLETE')
  })
  it.each([
    [new DOMException('private upstream details', 'TimeoutError'), 'GEMINI_TIMEOUT'],
    [
      new TypeError('private network details', { cause: { code: 'ECONNRESET' } }),
      'GEMINI_NETWORK_ERROR',
    ],
    [
      new TypeError('private TLS details', { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } }),
      'GEMINI_TLS_ERROR',
    ],
  ])('classifies transport failures without exposing upstream data', async (error, code) => {
    const client = new GeminiResearchClient(
      new ConfigService({ GEMINI_RESEARCH_ENABLED: true, GEMINI_API_KEY: 'secret' }),
    )
    global.fetch = jest.fn().mockRejectedValue(error)
    await expect(client.analyze([])).rejects.toThrow(code)
  })
  it.each([
    [503, 'GEMINI_TEMPORARILY_UNAVAILABLE'],
    [429, 'GEMINI_QUOTA_EXCEEDED'],
    [400, 'GEMINI_REQUEST_REJECTED'],
  ])('classifies HTTP %s safely', async (status, code) => {
    const client = new GeminiResearchClient(
      new ConfigService({ GEMINI_RESEARCH_ENABLED: true, GEMINI_API_KEY: 'secret' }),
    )
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('secret upstream body', { status: Number(status) }))
    await expect(client.analyze([])).rejects.toThrow(String(code))
  })
})
describe('Local anonymization', () => {
  it('rejects OCR texture over anatomy and low confidence characters', () => {
    const word = { text: 'ABCDEF', confidence: 99, bbox: { x0: 30, y0: 30, x1: 90, y1: 40 } }
    expect(backgroundTextMask(word, Buffer.alloc(200 * 100, 110), 200, 100)).toBeNull()
    expect(
      backgroundTextMask({ ...word, confidence: 20 }, Buffer.alloc(200 * 100), 200, 100),
    ).toBeNull()
    expect(backgroundTextMask({ ...word, text: 'I' }, Buffer.alloc(200 * 100), 200, 100)).toBeNull()
    const background = Buffer.alloc(200 * 100)
    for (let y = 31; y < 38; y++) for (let x = 32; x < 90; x += 4) background[y * 200 + x] = 255
    expect(backgroundTextMask(word, background, 200, 100)).not.toBeNull()
  })
  it('covers fractional mask boundaries with opaque pixels', async () => {
    const source = await sharp({
      create: { width: 120, height: 100, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer()
    const redacted = await redactResearchPng(source, [
      { x: 0.015, y: 0, width: 0.015, height: 0.5 },
    ])
    const pixel = await sharp(redacted)
      .extract({ left: 3, top: 10, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()
    expect([...pixel]).toEqual([0, 0, 0])
  })
  it('locates burned-in text locally and removes metadata from masked PNG', async () => {
    const service = new LocalTextRedactionService()
    try {
      const source = await sharp(
        Buffer.from(
          '<svg width="800" height="400"><rect width="800" height="400" fill="black"/><text x="90" y="210" font-family="Arial" font-size="48" fill="white">SYNTHETIC PERSON 123456</text></svg>',
        ),
      )
        .png()
        .withMetadata()
        .toBuffer()
      const masks = await service.detect(source, 800, 400)
      expect(masks.some((m) => m.y > 0.2 && m.y < 0.6 && m.width > 0.05)).toBe(true)
      const redacted = await redactResearchPng(source, masks),
        metadata = await sharp(redacted).metadata()
      expect(metadata.exif).toBeUndefined()
      expect(metadata.icc).toBeUndefined()
    } finally {
      await service.onModuleDestroy()
    }
  }, 30000)
})
