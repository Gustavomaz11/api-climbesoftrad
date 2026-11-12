export const initialCompanyId = '00000000-0000-4000-8000-000000000001'

export const resolveLegacyCompanyName = (
  configuredName: string | undefined,
  existingRows: number,
) => {
  const name = configuredName?.trim()
  if (existingRows > 0 && !name) {
    throw new Error('Defina LEGACY_COMPANY_NAME após confirmar a propriedade dos dados existentes.')
  }
  if (name && (name.length < 2 || name.length > 120)) {
    throw new Error('LEGACY_COMPANY_NAME deve conter entre 2 e 120 caracteres.')
  }
  return name || 'Sourad'
}
