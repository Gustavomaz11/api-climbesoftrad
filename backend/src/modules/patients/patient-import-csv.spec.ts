import { parsePatientIdentifierCsv, collidingImportLines } from './patient-import-csv'
const head = 'unitId;issuer;externalId;patientId;legacyIssuer;legacyExternalId\n'
describe('Legacy patient mapping CSV', () => {
  it('supports UTF-8 BOM, quotes and preserves exact original IDs', () => {
    const [row] = parsePatientIdentifierCsv('\ufeff' + head + 'u;Sistema;" 0001 ";p;Legado;"A;B"')
    expect(row).toMatchObject({ externalId: ' 0001 ', legacyExternalId: 'A;B' })
  })
  it('requires explicit columns and refuses empty input', () => {
    expect(() => parsePatientIdentifierCsv('name;value\nA;B')).toThrow()
    expect(() => parsePatientIdentifierCsv(head)).toThrow()
  })
  it('finds conflicting mappings within the file but accepts the same ID from another origin', () => {
    const rows = parsePatientIdentifierCsv(head + 'u;MV;1;p1;;\nu;MV;1;p2;;\nu;Outro;1;p3;;')
    expect([...collidingImportLines(rows)]).toEqual([0, 1])
  })
})
