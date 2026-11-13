# Minha fila

O médico vê os exames ainda sem responsável na fila geral. No laudário, **Iniciar elaboração** assume o exame e o move para **Minha fila**. Abrir o exame para consulta não atribui responsabilidade.

A atribuição é persistida em `exams.reporting_user_id` e `reporting_started_at`, no mesmo bloqueio transacional da mudança de estado e da auditoria. Fechar o editor ou expirar a presença não libera o exame. Outro médico não pode assumir, editar, enviar imagens ao rascunho nem finalizar o laudo atribuído.

`GET /exams?assignment=MINE` usa exclusivamente o usuário autenticado e preserva o escopo de empresa e unidades. Retorna exames ativos do médico, inclusive laudos finalizados ainda sem envio. Após o envio ao hospital, o exame sai dessa fila, mantendo o responsável registrado. `assignment=UNASSIGNED` lista os exames sem responsável. A listagem sem esse filtro continua disponível para supervisão administrativa.

Reabrir a preparação explicitamente ou cancelar o exame limpa a atribuição; uma invalidação automática de evidências preserva o responsável. Exames antigos em elaboração sem responsável podem ser assumidos pelo botão de iniciar. A migração recupera vínculos conhecidos a partir do histórico médico mais recente ou da finalização existente.

Validação: testes de navegação, integração de fila com dois médicos, concorrência, persistência sem presença, bloqueio de edição alheia, reversão por falha de auditoria, reabertura e saída após entrega. Dados sintéticos em banco de teste separado.
