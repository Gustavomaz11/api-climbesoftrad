# Publicação da API e do PostgreSQL no Render

## Escopo

Publicar `backend` como Web Service Node 24 e criar PostgreSQL 17 na mesma região (Virginia). Este deploy não publica os três frontends, Orthanc, OHIF, ClamAV nem um serviço Windows para gerar instaladores Router. Configure os endereços desses componentes quando estiverem disponíveis. O endpoint de download de instaladores permanece dependente do empacotador Windows e da aprovação do Sophos já solicitada à TI.

## Configuração do serviço

- Repositório: `https://github.com/Gustavomaz11/api-climbesoftrad`.
- Root Directory: `backend`.
- Build: `npm ci --include=dev && npm run build`.
- Pre-deploy: `npm run migration:run:prod`.
- Start: `npm start`.
- Health check: `/api/v1/health`.
- `NODE_ENV=production`, Node `24.11.1`; deixar `PORT` a cargo do Render.
- Usar a Internal Database URL do novo PostgreSQL em `DATABASE_URL`.

O modelo `render.yaml` usa API `0.5c-512mb` e banco `0.1c-256mb` com 1 GB. Conferir valores no painel antes de criar. O banco não expõe conexão pública no modelo; a API se conecta pela rede privada. Não aplicar o Blueprint sobre recursos existentes com o mesmo nome sem conferir se pertencem a esta aplicação.

## Segredos e URLs

Preencha o ambiente pelo modelo `backend/.env.render.example`. Nunca envie `.env` ou arquivos de pacientes ao GitHub. As chaves JWT ficam em Secret Files do Render, com caminhos `/etc/secrets/jwt_private.pem` e `/etc/secrets/jwt_public.pem`. Preserve a chave usada para criptografar credenciais Router caso haja migração de instalações existentes.

O Render termina o HTTPS. Configure `TRUST_PROXY_HOPS=1`, mantenha cookies seguros e deixe `ROUTER_TLS_KEY_PATH` e `ROUTER_TLS_CERT_PATH` vazios. Não copie os caminhos Windows de desenvolvimento.

`PUBLIC_API_URL` e `ROUTER_PUBLIC_API_URL` devem conter a URL HTTPS real mais `/api/v1`. `FRONTEND_ORIGIN` aceita origens HTTPS exatas separadas por vírgula. Até publicar os fronts, pode autorizar somente a própria origem HTTPS da API para verificação administrativa. Isso não disponibiliza uma interface de usuário. Quando publicar os fronts, cadastrar suas origens e conferir a política de cookies entre os domínios.

A análise Gemini permanece desabilitada nesta publicação; a integração existente é um protótipo de pesquisa separado da operação clínica. R2 é necessário para arquivos. Sem Orthanc/ClamAV/OHIF disponíveis, a API de cadastros pode funcionar, mas o recebimento e a visualização DICOM não estão homologados na nuvem.

## Validação e dados

Antes do primeiro envio, executar `node backend/scripts/audit-deploy-source.cjs`. O script verifica se arquivos sensíveis ou credenciais configuradas entrariam no Git.

Em banco vazio, migrations criam a estrutura e os cadastros canônicos; o bootstrap cria o administrador configurado. Migração de dados existentes exige decisão explícita, backup e restauração próprios; não é realizada apenas por executar migrations.

Após o deploy, verificar `/api/v1/health` e autenticação PKCE com administrador, além dos endpoints de unidades, médicos e modalidades. Não criar exames fictícios no banco de produção sem necessidade de homologação acordada. Registrar o commit publicado e a URL efetiva após confirmar a saúde do serviço.

## Publicação executada em 12/11/2026

- API: `https://api-climbesoftrad.onrender.com/api/v1`.
- Saúde: `https://api-climbesoftrad.onrender.com/api/v1/health`.
- Serviço Render: `srv-dbqsi1dg1s2s73f8srs0`.
- Primeiro deploy: `dep-dbqsi1tg1s2s73f8stj0`, commit de aplicação `79256e06ffbec4d746836cf7848778149764b8c3`.
- PostgreSQL: `climbesoftrad-db`, ID `dpg-dbqsdretlv9c73f1bsp0-a`, PostgreSQL 17, Virginia, banco/usuário `crm`, 1 GB.
- Recursos aprovados pelo responsável: API US$ 7/mês e PostgreSQL US$ 6,30/mês (compute e 1 GB), sujeitos a extras de uso do provedor.
- Banco novo para teste por escolha do responsável. Nenhuma restauração dos dados locais foi feita.
- Validados por HTTPS: saúde com banco disponível, login administrativo PKCE, acesso autenticado e listas vazias de unidades, médicos e exames; requisição sem credencial recusada; cookie Secure/HttpOnly e HSTS; logout 204.
- Todas as conexões públicas do PostgreSQL foram bloqueadas. A API usa a conexão interna.
- Arquivo de ambiente da instalação: `backend/.env.render.production`, ignorado pelo Git. Contém a senha administrativa nova do ambiente de teste; não copiar para issues, commits ou documentação pública.
- Os fronts continuam separados desta publicação. A origem HTTPS da própria API está autorizada temporariamente para a verificação administrativa; cadastrar as origens efetivas quando os fronts forem publicados.

Scripts operacionais adicionados: `prepare-render-env.cjs` prepara um arquivo local de ambiente a partir da configuração existente e da conexão exportada do painel; `smoke-render-api.cjs` valida o serviço sem imprimir credenciais. Dados de conexão e relatório de verificação ficam em `tmp/render-deploy`, fora do Git.
