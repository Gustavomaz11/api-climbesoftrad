import { BadRequestException } from '@nestjs/common'
import type { ContrastProtocolField } from '../../database/entities/contrast-protocol.entity'
export const validateContrastTemplate = (template: string, fields: ContrastProtocolField[]) => {
  const keys = fields.map((field) => field.key)
  if (keys.length !== new Set(keys).size || keys.includes('observations'))
    throw new BadRequestException('Campos duplicados ou reservados.')
  const placeholders = Array.from(template.matchAll(/\{\{([^{}]*)\}\}/g), (match) => match[1]!)
  if (
    placeholders.some((key) => key !== 'observations' && !keys.includes(key)) ||
    keys.some((key) => !placeholders.includes(key)) ||
    /\{\{|\}\}/.test(template.replace(/\{\{([^{}]*)\}\}/g, ''))
  )
    throw new BadRequestException(
      'O texto deve utilizar apenas os campos declarados e {{observations}}.',
    )
}
export const renderContrastTemplate = (
  template: string,
  fields: ContrastProtocolField[],
  values: Record<string, unknown>,
  observations: string,
) => {
  validateContrastTemplate(template, fields)
  if (Object.keys(values).some((key) => !fields.some((field) => field.key === key)))
    throw new BadRequestException('Campo não previsto no protocolo.')
  const rendered = new Map<string, string>([['observations', observations]])
  for (const field of fields) {
    const input = values[field.key]
    if (input !== undefined && typeof input !== 'string')
      throw new BadRequestException('Informe valores em texto.')
    const value = typeof input === 'string' ? input.trim() : ''
    if ((field.required && !value) || value.length > 500)
      throw new BadRequestException('Confira os campos obrigatórios e limites.')
    if (value && field.kind === 'NUMBER' && !/^(?:0|[1-9]\d{0,8})(?:[.,]\d{1,6})?$/.test(value))
      throw new BadRequestException('Valor numérico inválido.')
    const text = field.kind === 'NUMBER' ? value.replace(',', '.') : value
    rendered.set(field.key, value ? text + (field.unit ? ' ' + field.unit : '') : '')
  }
  return template.replace(
    /\{\{([^{}]*)\}\}/g,
    (_match: string, key: string) => rendered.get(key) ?? '',
  )
}
