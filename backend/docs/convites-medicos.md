# Acesso e e-mail dos médicos

O cadastro exige `email` válido. Novas identidades usam o CRM seguido da UF em maiúsculas, sem separador, como usuário e senha temporária (`7626SE`). `mustChangePassword=true` bloqueia as funcionalidades até a troca; em seguida, a importação da assinatura continua obrigatória. Formatos anteriores de usuário foram preservados.

O e-mail fica na identidade `auth_users`. Cadastrar em outra empresa uma identidade existente preserva usuário, senha e e-mail; um e-mail divergente é recusado. Médicos anteriores sem e-mail real não recebem convites retroativos.

O convite é registrado em `physician_access_emails` na mesma transação do cadastro. A fila não grava senhas nem o corpo do e-mail: compõe o conteúdo na entrega, usando a senha temporária apenas enquanto o primeiro acesso ainda está pendente. Se o médico já trocou a senha, um reenvio orienta a usar a senha atual.

## API Resend compartilhada com a Climbe

O ClimbeSoftRad utiliza a conta Resend já usada pela Climbe, com a chave da instalação publicada e o remetente do domínio verificado. A chave local antiga da Climbe foi recusada pelo provedor; as configurações da Climbe não foram alteradas.

```dotenv
EMAIL_PROVIDER=RESEND
API_RESEND_KEY=<chave-valida-apenas-no-backend>
EMAIL_FROM=notificacoes@envios.crmclimbe.com.br
EMAIL_REPLY_TO=contato@climbe.com.br
SOURAD_WEB_URL=https://climbesoftrad.vercel.app
```

O envio usa o SDK oficial por HTTPS, remetente exibido como **ClimbeSoftRad**, logo incorporado à mensagem e layout nas cores da central de laudos. As tags `application=climbesoftrad` e `purpose=physician_access` identificam estes disparos no provedor. Os e-mails da Climbe mantêm sua identidade original.

O provedor precisa retornar um identificador de mensagem para a fila registrar sucesso; recusas e falhas de rede continuam sujeitas a nova tentativa. A API usa uma chave de idempotência para evitar repetição durante novas tentativas. A geração dessa chave muda em um reenvio solicitado pelo usuário; o conteúdo também faz parte da identificação, para não reutilizar instruções antigas após uma troca de senha. A deduplicação do Resend vale por 24 horas, não por tempo ilimitado.

Referências: [SDK e envio](https://resend.com/docs/api-reference/emails/send-email), [idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys), [imagens incorporadas](https://resend.com/docs/dashboard/emails/embed-inline-images).

## Opção SMTP

```dotenv
SMTP_ENABLED=false
EMAIL_PROVIDER=SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SOURAD_WEB_URL=https://climbesoftrad.vercel.app
```

Sem provedor, mantenha `EMAIL_PROVIDER=SMTP` e `SMTP_ENABLED=false`. O cadastro funciona e a Gestão informa que o convite aguarda configuração. Para utilizar um servidor próprio, preencha as variáveis SMTP e use `SMTP_ENABLED=true`. Não há alternância automática de Resend para SMTP após falha. A validação recusa ativação sem as credenciais e o remetente do provedor escolhido. Não coloque credenciais nos frontends ou no Git.

A porta 587 usa STARTTLS obrigatório; a 465 usa `SMTP_SECURE=true`. A validação do certificado permanece habilitada. O botão do e-mail abre `/login` na origem de `SOURAD_WEB_URL`.

## Entrega e reenvio

Após o commit, a API tenta entregar os pendentes; também consulta a fila a cada 30 segundos. Sem provedor configurado, não consome tentativas. Uma reserva com expiração e bloqueio `SKIP LOCKED` protege o processamento concorrente. Falhas têm novas tentativas com espera progressiva, até oito tentativas. Reinícios recuperam reservas expiradas. Em SMTP ou após o prazo de deduplicação do Resend, uma interrupção após aceitação pelo provedor e antes da gravação do resultado pode provocar reentrega.

`SENT` significa aceitação pelo provedor, não confirmação de leitura ou de chegada à caixa de entrada. A Gestão apresenta a situação e permite **Reenviar e-mail**. O endpoint `POST /physicians/:id/access-email` exige permissão `physicians.create` e escopo de gestão do vínculo; preserva a senha e recusa vínculos revogados. Reenvio após uma entrega exige intervalo mínimo de um minuto.

Os testes usam mensagens e destinatários sintéticos e simulam a aceitação ou falha do provedor. O processamento automático é desabilitado em `NODE_ENV=test`, inclusive ao cadastrar médicos. Nenhum e-mail externo é enviado durante a suíte.
