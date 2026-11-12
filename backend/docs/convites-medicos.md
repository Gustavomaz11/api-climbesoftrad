# Acesso e e-mail dos médicos

O cadastro exige `email` válido. Novas identidades usam o CRM seguido da UF em maiúsculas, sem separador, como usuário e senha temporária (`7626SE`). `mustChangePassword=true` bloqueia as funcionalidades até a troca; em seguida, a importação da assinatura continua obrigatória. Formatos anteriores de usuário foram preservados.

O e-mail fica na identidade `auth_users`. Cadastrar em outra empresa uma identidade existente preserva usuário, senha e e-mail; um e-mail divergente é recusado. Médicos anteriores sem e-mail real não recebem convites retroativos.

O convite é registrado em `physician_access_emails` na mesma transação do cadastro. A fila não grava senhas nem o corpo do e-mail: compõe o conteúdo na entrega, usando a senha temporária apenas enquanto o primeiro acesso ainda está pendente. Se o médico já trocou a senha, um reenvio orienta a usar a senha atual.

## Configuração SMTP

```dotenv
SMTP_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SOURAD_WEB_URL=https://climbesoftrad.vercel.app
```

Sem provedor, mantenha `SMTP_ENABLED=false`. O cadastro funciona e a Gestão informa que o convite aguarda configuração. Para ativar, obtenha um serviço SMTP, preencha as variáveis no ambiente da API e use `SMTP_ENABLED=true`. A validação recusa ativação sem servidor, credenciais e remetente. Não coloque credenciais nos frontends ou no Git.

A porta 587 usa STARTTLS obrigatório; a 465 usa `SMTP_SECURE=true`. A validação do certificado permanece habilitada. O botão do e-mail abre `/login` na origem de `SOURAD_WEB_URL`.

## Entrega e reenvio

Após o commit, a API tenta entregar os pendentes; também consulta a fila a cada 30 segundos. Sem SMTP habilitado, não consome tentativas. Uma reserva com expiração e bloqueio `SKIP LOCKED` protege o processamento concorrente. Falhas têm novas tentativas com espera progressiva, até oito tentativas. Reinícios recuperam reservas expiradas. Como em outras filas de e-mail, uma interrupção após aceitação pelo SMTP e antes da gravação do resultado pode provocar reentrega.

`SENT` significa aceitação pelo servidor SMTP, não confirmação de leitura ou de chegada à caixa de entrada. A Gestão apresenta a situação e permite **Reenviar e-mail**. O endpoint `POST /physicians/:id/access-email` exige permissão `physicians.create` e escopo de gestão do vínculo; preserva a senha e recusa vínculos revogados. Reenvio após uma entrega exige intervalo mínimo de um minuto.

Os testes usam mensagens e destinatários sintéticos e simulam a aceitação ou falha do SMTP. Nenhum e-mail externo é enviado durante a suíte.
