import { physicianAccessEmail } from './physician-access-email.template'

describe('ClimbeSoftRad email identity', () => {
  const input = { name: '<Médico sintético>', username: '7626SE', initialPassword: '7626SE', loginUrl: 'https://climbesoftrad.example.test/login?a=1&b=2' }
  it('uses the software symbol, palette and name instead of the CRM investment template', () => {
    const { html } = physicianAccessEmail(input)
    expect(html).toContain('cid:climbesoftrad-logo')
    expect(html).toContain('background:#082f49')
    expect(html).toContain('Central de laudos')
    expect(html).toContain('Acessar ClimbeSoftRad')
    expect(html).not.toContain('Investimentos'); expect(html).not.toContain('Climbe CRM')
  })
  it('escapes names and URLs while preserving plain text access instructions', () => {
    const message = physicianAccessEmail(input)
    expect(message.html).toContain('&lt;Médico sintético&gt;')
    expect(message.html).toContain('/login?a=1&amp;b=2')
    expect(message.html).not.toContain(input.name)
    expect(message.text).toContain('Senha inicial: 7626SE')
    expect(message.text).toContain('obrigatoriamente')
  })
  it('does not reintroduce an initial password or password-change instructions after onboarding', () => {
    const message = physicianAccessEmail({ ...input, initialPassword: null })
    expect(message.html).toContain('Use sua senha atual')
    expect(message.html).not.toContain('Senha inicial')
    expect(message.html).not.toContain('Troca de senha obrigatória')
    expect(message.text).not.toContain('Após trocar a senha')
  })
})
