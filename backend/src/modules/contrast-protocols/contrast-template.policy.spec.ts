import { renderContrastTemplate, validateContrastTemplate } from './contrast-template.policy'

describe('Contrast protocol templates', () => {
  const fields = [
    {
      key: 'volume',
      label: 'Volume informado',
      kind: 'NUMBER' as const,
      unit: 'mL',
      required: true,
    },
  ]
  it('renders only clinician supplied values with explicit units and observations', () => {
    expect(
      renderContrastTemplate(
        'Valor: {{volume}}\n{{observations}}',
        fields,
        { volume: '12,50' },
        'Observação de teste',
      ),
    ).toBe('Valor: 12.50 mL\nObservação de teste')
  })
  it('rejects missing values, extra fields and malformed numeric inputs', () => {
    for (const values of [
      {},
      { volume: '10', secret: 'extra' },
      { volume: '2e3' },
      { volume: '-1' },
    ])
      expect(() => renderContrastTemplate('{{volume}}', fields, values, '')).toThrow()
  })
  it('rejects duplicate keys, unknown placeholders and fields omitted from the template', () => {
    expect(() => validateContrastTemplate('{{volume}}', [...fields, ...fields])).toThrow()
    expect(() => validateContrastTemplate('{{unknown}}', fields)).toThrow()
    expect(() => validateContrastTemplate('Texto sem campo', fields)).toThrow()
    expect(() => validateContrastTemplate('{{volume', fields)).toThrow()
  })
})
