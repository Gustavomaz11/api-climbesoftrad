import { parse } from 'csv-parse/sync'
import type { ImportedIdentifierRow } from '../../database/entities/patient-import-row.entity'
const headers = [
  'unitId',
  'issuer',
  'externalId',
  'patientId',
  'legacyIssuer',
  'legacyExternalId',
] as const
export const parsePatientIdentifierCsv = (text: string): ImportedIdentifierRow[] => {
  if (Buffer.byteLength(text, 'utf8') > 2_000_000) throw new Error('CSV excede 2 MB.')
  const rows: unknown = parse(text, {
    bom: true,
    delimiter: ';',
    columns: (columns: string[]) => {
      if (
        columns.length !== headers.length ||
        columns.some((name, index) => name.trim() !== headers[index])
      )
        throw new Error('Cabeçalho inválido. Use o modelo CSV.')
      return headers.slice()
    },
    skip_empty_lines: true,
    max_record_size: 10000,
  })
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
    throw new Error('CSV deve ter de 1 a 1000 linhas.')
  return rows.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('Linha inválida.')
    const record = row as Record<string, unknown>
    if (headers.some((key) => typeof record[key] !== 'string')) throw new Error('Campo inválido.')
    return {
      unitId: String(record.unitId).trim(),
      patientId: String(record.patientId).trim(),
      issuer: String(record.issuer).trim(),
      externalId: String(record.externalId),
      legacyIssuer: String(record.legacyIssuer).trim(),
      legacyExternalId: String(record.legacyExternalId),
    }
  })
}
export const identifierImportKeys = (row: ImportedIdentifierRow) => [
  { issuer: row.issuer, value: row.externalId },
  ...(row.legacyIssuer && row.legacyExternalId
    ? [{ issuer: row.legacyIssuer, value: row.legacyExternalId }]
    : []),
]
export const collidingImportLines = (rows: ImportedIdentifierRow[]) => {
  const keys = new Map<string, Set<string>>()
  rows.forEach((row) =>
    identifierImportKeys(row).forEach((key) => {
      const id = JSON.stringify([row.unitId, key.issuer, key.value])
      const patients = keys.get(id) ?? new Set<string>()
      patients.add(row.patientId)
      keys.set(id, patients)
    }),
  )
  return new Set(
    rows.flatMap((row, index) =>
      identifierImportKeys(row).some(
        (key) => (keys.get(JSON.stringify([row.unitId, key.issuer, key.value]))?.size ?? 0) > 1,
      )
        ? [index]
        : [],
    ),
  )
}
