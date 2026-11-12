import { documentAvailability } from './patient-document-availability'
describe('Disponibilidade documental do histórico', () => {
  it('separa falta de acesso, ausência e arquivo inválido', () => {
    expect(documentAvailability(undefined, 'exam')).toBe('NOT_AUTHORIZED')
    expect(documentAvailability(null, 'exam')).toBe('UNAVAILABLE')
    expect(documentAvailability('{', 'exam')).toBe('RECOVERY_REQUIRED')
  })
  it('rejeita arquivo de outro exame', () =>
    expect(
      documentAvailability(JSON.stringify({ examId: 'other', content: { type: 'doc' } }), 'exam'),
    ).toBe('RECOVERY_REQUIRED'))
  it('distingue rascunho e identificação visual da prescrição', () => {
    const body = JSON.stringify({
      examId: 'exam',
      content: { type: 'doc' },
      signature: { name: 'Médico' },
    })
    expect(documentAvailability(body, 'exam')).toBe('DRAFT_AVAILABLE')
    expect(documentAvailability(body, 'exam', true)).toBe('SIGNED_VISUAL_AVAILABLE')
  })
})
