# Assinatura, versões e reavaliação

## Uso

- **Laudando:** sessão exclusiva no laudário, identificada por médico e cliente. Outro painel não pode editar; outro médico não pode abrir o conteúdo em edição.
- **Digitado:** conteúdo salvo e ainda não liberado. Permanece no nome do médico anterior. Outro médico precisa justificar a continuidade antes de acessar o conteúdo e assumir a edição.
- **Assinado:** primeira versão liberada e imutável.
- **Reassinado:** nova versão assinada após correção justificada. A versão anterior, assinatura, CRM, apresentação e conteúdo permanecem preservados.
- **Reavaliar:** pedido feito pelo Hospital ou pela Gestão. O médico autorizado pode corrigir e reassinar ou revalidar sem alteração.
- **Revalidado sem Modificação:** encerra a solicitação com justificativa, preservando integralmente a versão e assinatura existentes.
- **Pendente** e **Reconvocar para Corrigir / Complementar:** mantêm os fluxos operacionais existentes, com distinção explícita da finalidade da reconvocação.

No Hospital, abra um laudo recebido e use **Solicitar reavaliação**. Na Gestão, use **Reavaliação de laudos → Gerenciar revisão → Autorizar outro médico**. No ClimbeSoftRad, o médico usa **Corrigir e reassinar** ou **Revalidar sem modificação**. O histórico e as versões anteriores ficam disponíveis no próprio laudo.

## Autorização e auditoria

A correção exige um médico com acesso ativo à unidade, inscrição regular e permissão de assinatura. Pode corrigir o autor da versão atual, um médico com a permissão `reports.resign.other` (cargo Médico sênior), ou um médico autorizado pela gerência para aquela versão específica. A autorização não se estende automaticamente a versões futuras. A nova versão sempre usa a assinatura atual do médico que efetivamente a assina.

Pedidos, justificativas, autorizações, consultas de versões, assinaturas, reassinaturas, entregas e solicitações de impressão/exportação são registrados. A impressão e a exportação pelo sistema só abrem a janela do navegador após o registro da solicitação. A escolha de impressora, a confirmação da impressão física e a gravação pelo diálogo do sistema operacional não são informadas à aplicação. A impressão nativa fora desse fluxo oculta o documento e orienta a usar os botões auditados.

O Hospital recebe a versão nova somente após o envio explícito. Até esse momento, a última versão enviada continua disponível, com seu histórico. A lista de resultados apresenta a última versão enviada de cada exame; links de versões anteriores permanecem consultáveis com o mesmo isolamento de hospital e unidade.

## Persistência e sessões

Os rascunhos novos ficam em `exam_report_drafts` no PostgreSQL. Rascunhos antigos do R2 são carregados e preservados no primeiro acesso. Imagens continuam no armazenamento de objetos. A escrita do texto, sua auditoria e o encerramento da sessão pertencem à mesma transação; falha de auditoria não libera a sessão nem substitui o último conteúdo salvo.

`exam_report_sessions` permite um cliente por exame. Escritas e assinatura exigem o identificador do cliente ativo; um painel antigo não pode sobrescrever o trabalho de um novo responsável. O encerramento forçado é solicitado pela administração com justificativa. O painel congela a digitação, envia seu conteúdo e sai somente após confirmação. Se o painel ficar desconectado, a sessão expira em até 90 segundos sem renovação; preserva-se o último conteúdo efetivamente recebido pelo servidor.

`exam_report_completions` armazena versões numeradas com vínculo à versão anterior, motivo, hash, médico e assinatura. O banco impede atualização do conteúdo assinado e exclusão individual de versões. `exam_report_reviews` guarda solicitações e resoluções; `exam_report_authorizations` vincula a liberação ao médico e à versão. As migrações preservam o conteúdo histórico; a migração de ciclo de laudos exige correções futuras por nova migração, sem apagar versões para reverter o esquema.

Validação: testes com médicos distintos, médico sênior, gerência e hospital; concorrência de clientes; encerramento com salvamento; expiração; rollback por falha de auditoria; isolamento entre unidades; imutabilidade e entrega de versões; testes de interface com dados sintéticos nos três portais.
