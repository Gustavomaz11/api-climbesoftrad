import { resolvePresentation } from './company-presentation'

describe('Company document presentation', () => {
  it('uses company values with unit overrides and a membership signature', () => {
    expect(
      resolvePresentation(
        { headerText: 'Company A', footerText: 'Company footer', signatureText: 'Default' },
        { footerText: 'Unit footer' },
        'Doctor in company A',
      ),
    ).toEqual({
      headerText: 'Company A',
      footerText: 'Unit footer',
      signatureText: 'Doctor in company A',
    })
  })

  it('does not mutate earlier snapshots when a different context is resolved', () => {
    const snapshot = resolvePresentation({ headerText: 'Company A' }, {}, null)
    resolvePresentation({ headerText: 'Company B' }, {}, 'Other signature')
    expect(snapshot.headerText).toBe('Company A')
    expect(snapshot.signatureText).toBe('')
  })
})
