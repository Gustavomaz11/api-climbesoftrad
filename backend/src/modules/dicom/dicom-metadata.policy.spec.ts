import { mapDicomMetadata, stableStudyIdentity } from './dicom-metadata.policy'

describe('DICOM identities and demographics', () => {
  const tags = {
    studyUid: '1.2.3',
    seriesUid: '1.2.4',
    instanceUid: '1.2.5',
    sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
    patientId: '001',
    issuer: 'HOSP',
    patientName: 'Teste^Paciente',
    birthDate: '19900101',
    sex: 'F',
    studyDate: '20261014',
    studyTime: '120000',
    timezone: '-0300',
    modality: 'CT',
    description: 'TC de tórax',
    accessionNumber: 'A1',
    transferSyntax: '1.2.840.10008.1.2.1',
  }
  it('preserves exact IDs and uses one study key for manual import and agent', () => {
    const mapped = mapDicomMetadata(tags)
    expect(mapped.dto).toMatchObject({
      patientName: 'Teste Paciente',
      birthDate: '1990-01-01',
      sex: 'FEMININO',
      performedAt: '2026-10-14T12:00:00-03:00',
      externalPatientId: '001',
    })
    expect(stableStudyIdentity('company', 'unit', '1.2.3')).toBe(
      stableStudyIdentity('company', 'unit', '1.2.3'),
    )
  })
  it('routes missing or unsupported demographics to review without inventing values', () => {
    for (const overrides of [
      { birthDate: '' },
      { sex: 'O' },
      { patientName: '' },
      { timezone: '' },
      { modality: 'INVALID' },
      { studyDate: '20260230' },
    ])
      expect(mapDicomMetadata({ ...tags, ...overrides }).issues.length).toBeGreaterThan(0)
    expect(() => mapDicomMetadata({ ...tags, studyUid: 'invalid/uid' })).toThrow()
  })
  it('preserves study identity when a later series has a different modality',()=>{
    expect(mapDicomMetadata({...tags,modality:'MR'}).identityHash).toBe(mapDicomMetadata(tags).identityHash)
  })
  it('extracts patient measurements, institution, requester and Study ID', () => {
    const source = { ...tags, patientSize: '1.51', patientWeight: '71', institutionName: 'Hospital de teste', referringPhysicianName: 'Silva^Ana Maria', studyId: 'STUDY-123' }
    expect(mapDicomMetadata(source).dto).toMatchObject({ heightMeters: 1.51, weightKg: 71, institutionName: 'Hospital de teste', requesterName: 'Ana Maria Silva', studyId: 'STUDY-123', studyDate: '2026-10-14', studyTime: '12:00:00' })
  })
  it('preserves study date and local time without inventing a timezone', () => {
    const result = mapDicomMetadata({ ...tags, timezone: '', studyTime: '113457.125' })
    expect(result.dto).toMatchObject({ studyDate: '2026-10-14', studyTime: '11:34:57.125' })
    expect(result.dto.performedAt).toBeUndefined()
    expect(result.issues).toContain('Fuso do estudo ausente ou inválido.')
  })
  it('leaves unknown measurements empty and reports malformed nonempty values', () => {
    const unknown = { ...tags, patientSize: '0', patientWeight: '' }
    expect(mapDicomMetadata(unknown).dto).not.toHaveProperty('heightMeters')
    expect(mapDicomMetadata(unknown).dto).not.toHaveProperty('weightKg')
    const invalid = { ...tags, patientSize: '1.51 m', patientWeight: '-71' }
    expect(mapDicomMetadata(invalid).issues).toEqual(expect.arrayContaining(['Altura do paciente inválida.', 'Peso do paciente inválido.']))
  })
})
