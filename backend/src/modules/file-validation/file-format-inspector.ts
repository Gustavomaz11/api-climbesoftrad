import { open, readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { parseDicom } from 'dicom-parser'
import type { DicomTags } from '../dicom/dicom-metadata.policy'
import { assertDicomPixelIntegrity } from './dicom-pixel-integrity'

export const inspectDocument = async (path: string, contentType: string) => {
  if (contentType === 'application/pdf') {
    const document = await PDFDocument.load(await readFile(path), {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
    })
    if (document.getPageCount() < 1) throw new Error('PDF sem páginas.')
    return
  }
  const image = sharp(path, { failOn: 'warning', limitInputPixels: 16_000_000, animated: true })
  const metadata = await image.metadata()
  const expected = (
    {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    } as Record<string, string>
  )[contentType]
  if (!expected || metadata.format !== expected)
    throw new Error('Conteúdo difere do formato informado.')
  await image.stats()
}

export const inspectDicom = async (path: string): Promise<DicomTags> => {
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(16 * 1024 * 1024)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    const bytes = header.subarray(0, bytesRead)
    if (bytesRead < 132 || bytes.toString('ascii', 128, 132) !== 'DICM')
      throw new Error('Arquivo DICOM Part 10 inválido.')
    const data = parseDicom(bytes, { untilTag: 'x7fe00010',inflater:()=>{throw new Error('Dataset deflate requer homologação incremental.')} })
    await assertDicomPixelIntegrity(file, data, (await file.stat()).size)
    const charset = data.string('x00080005')?.trim() ?? ''
    const text = (tag: string) => {
      const element = data.elements[tag]
      if (!element) return ''
      const encoding =
        charset === 'ISO_IR 192' ? 'utf-8' : charset === 'ISO_IR 100' ? 'windows-1252' : 'ascii'
      return new TextDecoder(encoding)
        .decode(data.byteArray.subarray(element.dataOffset, element.dataOffset + element.length))
        .replaceAll('\0', '')
        .trimEnd()
    }
    const metaInstance = data.string('x00020003')?.trim(),
      instanceUid = text('x00080018')
    if (metaInstance !== instanceUid || data.string('x00020002')?.trim() !== text('x00080016'))
      throw new Error('UIDs do cabeçalho e conjunto de dados divergem.')
    return {
      studyUid: text('x0020000d'),
      seriesUid: text('x0020000e'),
      instanceUid,
      sopClassUid: text('x00080016'),
      transferSyntax: data.string('x00020010')?.trim() ?? '',
      patientId: text('x00100020'),
      issuer: text('x00100021'),
      patientName: text('x00100010'),
      birthDate: text('x00100030'),
      sex: text('x00100040'),
      studyDate: text('x00080020'),
      studyTime: text('x00080030'),
      timezone: text('x00080201'),
      modality: text('x00080060'),
      description: text('x00081030'),
      accessionNumber: text('x00080050'),
      patientSize: text('x00101020'),
      patientWeight: text('x00101030'),
      institutionName: text('x00080080'),
      referringPhysicianName: text('x00080090'),
      studyId: text('x00200010'),
      charset,
    }
  } finally {
    await file.close()
  }
}
