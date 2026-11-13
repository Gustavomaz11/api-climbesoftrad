# Minha fila

O médico vê os exames ainda sem responsável na fila geral. No laudário, **Iniciar elaboração** assume o exame e o move para **Minha fila**. Abrir o exame para consulta não atribui responsabilidade.

A atribuição é persistida em `exams.reporting_user_id` e `reporting_started_at`, no mesmo bloqueio transacional da mudança de estado e da auditoria. Ao salvar e sair, um laudo com conteúdo passa para Digitado e mantém o responsável. Enquanto o médico estiver Laudando, o painel é exclusivo. Outro médico só pode acessar e continuar um Digitado após justificar a transferência; laudos já assinados seguem a autorização de correção descrita em [Ciclo do laudo](report-lifecycle.md).

`GET /exams?assignment=MINE` usa exclusivamente o usuário autenticado e preserva o escopo de empresa e unidades. Retorna exames ativos do médico, inclusive laudos assinados ainda sem envio e reavaliações pendentes. Após o envio ao hospital, o exame sai dessa fila, mantendo o responsável registrado; uma reavaliação pode trazê-lo de volta. `assignment=UNASSIGNED` lista exames sem responsável e Digitados disponíveis para continuidade justificada. A listagem sem esse filtro continua disponível para supervisão administrativa.

Reabrir a preparação explicitamente ou cancelar o exame limpa a atribuição; uma invalidação automática de evidências preserva o responsável. Exames antigos em elaboração sem responsável podem ser assumidos pelo botão de iniciar. A migração recupera vínculos conhecidos a partir do histórico médico mais recente ou da finalização existente.

Validação: testes de navegação, integração de fila com dois médicos, concorrência, persistência sem presença, bloqueio de edição alheia, reversão por falha de auditoria, reabertura e saída após entrega. Dados sintéticos em banco de teste separado.
