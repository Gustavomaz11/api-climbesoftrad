export interface DocumentPresentation {
  headerText: string
  footerText: string
  signatureText: string
}

export const resolvePresentation = (
  company: Partial<DocumentPresentation>,
  unit: Partial<DocumentPresentation>,
  membershipSignature: string | null,
): DocumentPresentation => ({
  headerText: unit.headerText ?? company.headerText ?? '',
  footerText: unit.footerText ?? company.footerText ?? '',
  signatureText: membershipSignature ?? unit.signatureText ?? company.signatureText ?? '',
})
