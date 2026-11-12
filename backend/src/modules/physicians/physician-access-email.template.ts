const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!))

export const physicianAccessEmail = (input: {
  name: string; username: string; initialPassword: string | null; loginUrl: string
}) => {
  const passwordText = input.initialPassword
    ? `Senha inicial: ${input.initialPassword}\nAo acessar, você deverá criar uma nova senha obrigatoriamente.`
    : 'Use sua senha atual. Este aviso não altera sua senha.'
  const signatureText = input.initialPassword
    ? 'Após trocar a senha, importe a imagem da sua assinatura para poder finalizar laudos.'
    : 'Mantenha a imagem da sua assinatura cadastrada para poder finalizar laudos.'
  const text = `Olá, ${input.name}.\n\nVocê recebeu acesso ao ClimbeSoftRad.\nUsuário: ${input.username}\n${passwordText}\n\n${signatureText}\n\nAcessar ClimbeSoftRad: ${input.loginUrl}`
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seu acesso ao ClimbeSoftRad</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Seu acesso à central de laudos. Confira as instruções para entrar no ClimbeSoftRad.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dbe5ee;border-radius:16px;overflow:hidden">
  <tr><td style="padding:28px;background:#082f49;border-bottom:4px solid #06a6b8">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="padding-right:14px"><img src="cid:climbesoftrad-logo" alt="Símbolo ClimbeSoftRad" width="48" height="48" style="display:block;border:0;border-radius:12px"></td>
      <td><p style="margin:0;color:#ffffff;font-size:23px;font-weight:700;letter-spacing:-.5px">ClimbeSoftRad</p><p style="margin:7px 0 0;color:#a5f3fc;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Central de laudos</p></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px 28px 8px">
    <span style="display:inline-block;padding:7px 10px;border-radius:6px;background:#ecfeff;color:#03658a;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Acesso médico</span>
    <h1 style="margin:18px 0 18px;color:#082f49;font-size:28px;line-height:35px;letter-spacing:-.7px">Seu acesso está pronto.</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:24px">Olá, <strong>${escapeHtml(input.name)}</strong>.</p>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:24px">Você recebeu acesso ao ClimbeSoftRad, a central para receber exames e elaborar laudos.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0f9ff;border:1px solid #cce6ef;border-radius:12px"><tr><td style="padding:20px">
      <p style="margin:0 0 7px;color:#03658a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px">Usuário</p>
      <p style="margin:0;color:#082f49;font-family:Consolas,'Courier New',monospace;font-size:23px;font-weight:700;letter-spacing:1px">${escapeHtml(input.username)}</p>
      ${input.initialPassword ? `<p style="margin:20px 0 7px;color:#03658a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px">Senha inicial</p>
      <p style="margin:0;color:#082f49;font-family:Consolas,'Courier New',monospace;font-size:23px;font-weight:700;letter-spacing:1px">${escapeHtml(input.initialPassword)}</p>` : '<p style="margin:16px 0 0;color:#475569;font-size:14px;line-height:22px">Use sua senha atual. Este aviso não altera sua senha.</p>'}
    </td></tr></table>
    ${input.initialPassword ? '<p style="margin:20px 0 0;padding-left:12px;border-left:3px solid #06a6b8;color:#0c4a6e;font-size:14px;line-height:23px"><strong>Troca de senha obrigatória:</strong> ao acessar pela primeira vez, você deverá criar uma nova senha antes de continuar.</p>' : ''}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td align="center" style="border-radius:10px;background:#0c4a6e">
      <a href="${escapeHtml(input.loginUrl)}" style="display:block;padding:17px 20px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;text-align:center">Acessar ClimbeSoftRad</a>
    </td></tr></table>
    <p style="margin:0 0 22px;color:#475569;font-size:14px;line-height:23px">${signatureText}</p>
    <p style="margin:0 0 20px;color:#64748b;font-size:12px;line-height:20px">Se o botão não abrir, copie este endereço no navegador:<br><a href="${escapeHtml(input.loginUrl)}" style="color:#03658a;word-break:break-all">${escapeHtml(input.loginUrl)}</a></p>
  </td></tr>
  <tr><td style="padding:20px 28px;border-top:1px solid #e2e8f0;background:#f8fafc"><p style="margin:0;color:#0c4a6e;font-size:12px;font-weight:700">ClimbeSoftRad · Central de laudos</p><p style="margin:7px 0 0;color:#64748b;font-size:11px;line-height:18px">Mensagem automática de acesso. Guarde suas credenciais com segurança.</p></td></tr>
</table></td></tr></table></body></html>`
  return { subject: 'Você recebeu acesso ao ClimbeSoftRad', text, html }
}
