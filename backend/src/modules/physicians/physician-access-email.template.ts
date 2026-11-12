const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!))

export const physicianAccessEmail = (input: {
  name: string; username: string; initialPassword: string | null; loginUrl: string
}) => {
  const passwordText = input.initialPassword
    ? `Senha inicial: ${input.initialPassword}\nAo acessar, você deverá criar uma nova senha obrigatoriamente.`
    : 'Use sua senha atual. Este aviso não altera sua senha.'
  const signatureText = 'Após trocar a senha, importe a imagem da sua assinatura para poder finalizar laudos.'
  const text = `Olá, ${input.name}.\n\nVocê recebeu acesso ao ClimbeSoftRad.\nUsuário: ${input.username}\n${passwordText}\n\n${signatureText}\n\nAcessar ClimbeSoftRad: ${input.loginUrl}`
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0b3045">
    <h1 style="font-size:24px">Seu acesso ao ClimbeSoftRad</h1>
    <p>Olá, ${escapeHtml(input.name)}.</p><p>Você recebeu acesso ao ClimbeSoftRad.</p>
    <p><strong>Usuário:</strong> ${escapeHtml(input.username)}</p>
    ${input.initialPassword ? `<p><strong>Senha inicial:</strong> ${escapeHtml(input.initialPassword)}</p>
    <p>Ao acessar, você deverá criar uma nova senha obrigatoriamente.</p>` : '<p>Use sua senha atual. Este aviso não altera sua senha.</p>'}
    <p>${signatureText}</p>
    <p style="margin:28px 0"><a href="${escapeHtml(input.loginUrl)}" style="background:#0e5071;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;display:inline-block">Acessar ClimbeSoftRad</a></p>
    <p style="font-size:12px">Se o botão não abrir, acesse ${escapeHtml(input.loginUrl)}</p></div>`
  return { subject: 'Você recebeu acesso ao ClimbeSoftRad', text, html }
}
