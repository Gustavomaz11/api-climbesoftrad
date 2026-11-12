import { PDFDocument } from 'pdf-lib'
export const syntheticPdf = async () => {
  const document = await PDFDocument.create()
  document.addPage([100, 100])
  return Buffer.from(await document.save())
}
const stringElement = (group: number, element: number, vr: string, value: string) => {
  const bytes = Buffer.from(value + (value.length % 2 ? (vr === 'UI' ? '\0' : ' ') : ''), 'ascii')
  const header = Buffer.alloc(8)
  header.writeUInt16LE(group, 0)
  header.writeUInt16LE(element, 2)
  header.write(vr, 4)
  header.writeUInt16LE(bytes.length, 6)
  return Buffer.concat([header, bytes])
}
const unsignedElement = (element: number, value: number) => {
  const header = Buffer.alloc(10)
  header.writeUInt16LE(40, 0)
  header.writeUInt16LE(element, 2)
  header.write('US', 4)
  header.writeUInt16LE(2, 6)
  header.writeUInt16LE(value, 8)
  return header
}
export const syntheticDicom = (override: Record<string, string> = {}) => {
  const values = {
    study: '1.2.826.0.1.3680043.10.100.1',
    series: '1.2.826.0.1.3680043.10.100.2',
    instance: '1.2.826.0.1.3680043.10.100.3',
    patient: 'SYNTHETIC-001',
    name: 'Teste^Paciente',
    birth: '19900101',
    sex: 'F',
    date: '20261014',
    time: '120000',
    timezone: '-0300',
    modality:'CT',
    institution: '', referringPhysician: '', height: '', weight: '', studyId: '',
    ...override,
  }
  const sop = '1.2.840.10008.5.1.4.1.1.7',
    syntax = '1.2.840.10008.1.2.1'
  const elements = [
    stringElement(2, 2, 'UI', sop),
    stringElement(2, 3, 'UI', values.instance),
    stringElement(2, 16, 'UI', syntax),
    stringElement(8, 5, 'CS', 'ISO_IR 6'),
    stringElement(8, 22, 'UI', sop),
    stringElement(8, 24, 'UI', values.instance),
    stringElement(8, 32, 'DA', values.date),
    stringElement(8, 48, 'TM', values.time),
    stringElement(8, 80, 'SH', 'SYNTHETIC'),
    stringElement(8, 96, 'CS', values.modality),
    ...(values.institution ? [stringElement(8, 128, 'LO', values.institution)] : []),
    ...(values.referringPhysician ? [stringElement(8, 144, 'PN', values.referringPhysician)] : []),
    stringElement(8, 513, 'SH', values.timezone),
    stringElement(8, 4144, 'LO', 'TC teste'),
    stringElement(16, 16, 'PN', values.name),
    stringElement(16, 32, 'LO', values.patient),
    stringElement(16, 33, 'LO', 'SYNTHETIC-HOSP'),
    stringElement(16, 48, 'DA', values.birth),
    stringElement(16, 64, 'CS', values.sex),
    ...(values.height ? [stringElement(16, 4128, 'DS', values.height)] : []),
    ...(values.weight ? [stringElement(16, 4144, 'DS', values.weight)] : []),
    stringElement(32, 13, 'UI', values.study),
    stringElement(32, 14, 'UI', values.series),
    ...(values.studyId ? [stringElement(32, 16, 'SH', values.studyId)] : []),
    unsignedElement(2, 1),
    stringElement(40, 4, 'CS', 'MONOCHROME2'),
    unsignedElement(16, 1),
    unsignedElement(17, 1),
    unsignedElement(256, 8),
    unsignedElement(257, 8),
    unsignedElement(258, 7),
    unsignedElement(259, 0),
  ]
  const pixel = Buffer.alloc(14)
  pixel.writeUInt16LE(0x7fe0, 0)
  pixel.writeUInt16LE(0x0010, 2)
  pixel.write('OB', 4)
  pixel.writeUInt32LE(2, 8)
  pixel[12] = 128
  const preamble = Buffer.alloc(132)
  preamble.write('DICM', 128)
  return Buffer.concat([preamble, ...elements, pixel])
}
