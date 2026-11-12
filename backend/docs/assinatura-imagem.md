# Validação da imagem da assinatura

Em 12/11/2026, `POST /api/v1/physicians/me/signature` retornava 500 no Render porque chamava a validação genérica de anexos, que exige ClamAV. O log registrava `Varredura ainda não configurada.`. A assinatura passou a usar um processo específico de reconstrução de imagem.

## Processo específico

- Somente o próprio médico, após trocar a senha inicial, pode salvar a assinatura.
- PNG e JPEG de até 2 MB, com cabeçalho e formato real correspondentes ao MIME informado.
- Decodificação completa com limite de 16 milhões de pixels e tempo de processamento limitado.
- Recusa de imagens uniformes, invisíveis, truncadas, incompatíveis ou animadas, incluindo chunks de controle de APNG.
- Orientação automática, composição da transparência sobre fundo branco, remoção de margens uniformes e redução proporcional para até 1.000 × 320 pixels.
- Extração de pixels RGB e criação de um novo PNG exclusivamente a partir desses pixels, com até 256 KB. O arquivo original, seus metadados e os dados após o final da imagem não são armazenados.
- Persistência da imagem reconstruída, identificador, SHA-256 e data, com auditoria na mesma transação.

Essa política é específica da assinatura, cuja imagem é inserida no laudo. Não representa uma declaração de que o arquivo original foi aprovado por antivírus. Os uploads genéricos de anexos e DICOM continuam usando sua validação com antivírus e recusa quando o scanner está indisponível.

A reconstrução de imagens é uma das medidas de validação de conteúdo descritas pela [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html#file-content-validation); não substitui a manutenção do decodificador nem garante a ausência de todas as vulnerabilidades de processamento. O decodificador permanece restrito a PNG/JPEG e aos limites acima.

## Verificação

O teste integrado configura o scanner como indisponível e percorre senha → importação → acesso, verificando que o arquivo é reconstruído sem chamar o scanner genérico. Também há testes de JPEG, PNG transparente, metadados e dados anexados, tipo forjado, truncamento, tamanho, pixels e animação. A suíte genérica continua verificando a recusa de varreduras indisponíveis ou infectadas; a suíte de entrega verifica aplicação e preservação da assinatura no laudo.
