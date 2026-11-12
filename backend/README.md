# HealthCRM API — Autenticação

API NestJS modular para a primeira versão da autenticação do HealthCRM. O escopo inclui criação de conta controlada por ambiente, login com PKCE S256, JWT RS256, refresh token opaco com rotação, restauração de sessão, logout e usuário autenticado.

## Pré-requisitos

- Node.js 24 LTS e npm
- PostgreSQL 17, ou Docker Desktop com Docker Compose

## Configuração local

```powershell
cd backend
Copy-Item .env.example .env
npm ci
npm run keys:generate
```

As chaves são gravadas em `backend/secrets/`, que é ignorado pelo Git. Não compartilhe nem versione esses arquivos.

Variáveis principais:

| Variável                                       | Finalidade                                  | Desenvolvimento                           |
| ---------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| `DATABASE_URL`                                 | Conexão PostgreSQL                          | `postgresql://crm:crm@localhost:5432/crm` |
| `FRONTEND_ORIGIN`                              | Allowlist CORS/Origin, separada por vírgula | `http://localhost:5173`                   |
| `OAUTH_CLIENT_ID`                              | Public client permitido                     | `crm-web`                                 |
| `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` | Chaves PEM RS256                            | arquivos em `secrets/`                    |
| `ACCESS_TOKEN_TTL_SECONDS`                     | Validade do access token                    | `600`                                     |
| `AUTHORIZATION_CODE_TTL_SECONDS`               | Validade do authorization code              | `60`                                      |
| `REFRESH_TOKEN_TTL_DAYS`                       | Validade máxima da sessão/refresh           | `30`                                      |
| `PUBLIC_REGISTRATION_ENABLED`                  | Libera cadastro direto                      | `true` somente localmente                 |
| `COOKIE_SECURE`                                | Exige HTTPS no cookie                       | `false` somente localmente                |

Em produção, use HTTPS, `COOKIE_SECURE=true`, cadastro público desabilitado e chaves fornecidas por secret manager/arquivo montado.

## Certificado HTTPS da rede corporativa

Se o laudário retornar erro 500 e a API registrar `unable to verify the first certificate`,
verifique o certificado apresentado pela rede ao acessar o R2. Redes com inspeção HTTPS
podem utilizar uma CA corporativa confiável no Windows que não existe no contêiner.

Exporte somente o certificado público da CA correspondente, já confiável no Windows,
em formato PEM para `backend/secrets/corporate-ca.pem`. Na raiz do projeto, crie um
`docker-compose.override.yml` local (ignorado pelo Git):

```yaml
services:
  api:
    environment:
      NODE_EXTRA_CA_CERTS: /run/certs/corporate-ca.pem
    volumes:
      - type: bind
        source: ./backend/secrets/corporate-ca.pem
        target: /run/certs/corporate-ca.pem
        read_only: true
        bind:
          create_host_path: false
```

Execute `docker compose up -d --no-deps api` na raiz para recriar a API com essa
configuração. O Compose carrega o override automaticamente. A validação TLS continua
ativa; não configure `NODE_TLS_REJECT_UNAUTHORIZED=0`. O certificado e o override
pertencem à máquina local e não devem ser incluídos na imagem de produção.

Referência: [certificados adicionais no Node.js](https://nodejs.org/api/cli.html#node_extra_ca_certsfile).

## Executar com Docker

Na raiz do repositório:

```powershell
cd backend
npm run keys:generate
cd ..
docker compose build
docker compose up -d
docker compose ps
```

No PowerShell, execute `build` e `up` em linhas separadas. O caractere `|` cria um pipe e pode iniciar os contêineres com uma imagem antiga mesmo quando o build falha.

Use `npm ci` para instalar o backend sem regravar o `package-lock.json`, que contém também dependências opcionais exigidas pelo build Linux.

O contêiner da API aguarda o PostgreSQL, executa as migrations pendentes e inicia em `http://localhost:3000`. Health check: `GET http://localhost:3000/api/v1/health`. Swagger local: `http://localhost:3000/api/docs`.

Para encerrar sem remover os dados:

```powershell
docker compose stop
```

## Executar sem Docker

Com um PostgreSQL disponível e o `.env` preenchido:

```powershell
cd backend
npm run migration:run
npm run start:dev
```

As tabelas são criadas exclusivamente por migration; `synchronize` permanece desabilitado.

## Criar conta e testar o login

Para desenvolvimento, mantenha `PUBLIC_REGISTRATION_ENABLED=true` e crie a conta por API:

```powershell
$body = @{ fullName = 'Usuário Local'; email = 'usuario@hospital.com.br'; password = 'uma senha local segura' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/v1/auth/register -ContentType application/json -Body $body
```

Depois inicie o frontend e entre com a conta criada:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm install
npm run dev
```

Abra `http://localhost:5173/login`. O frontend gera `state`, `code_verifier` e challenge S256 via Web Crypto, troca o authorization code e mantém o access token somente em memória. O refresh token fica exclusivamente no cookie HttpOnly.

## Endpoints

Todos usam o prefixo `/api/v1`:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/token` — grants `authorization_code` e `refresh_token`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /health`

## Validação

Os testes E2E requerem PostgreSQL acessível pela `DATABASE_URL` de `.env.test`.

```powershell
cd backend
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Os testes cobrem registro, lockout, PKCE, expiração e reutilização de codes, JWT, rotação e reutilização de refresh tokens, logout, Origin e concorrência transacional.

## Empresas, unidades e acesso

Veja [contratos, migração e validação da frente 1](../docs/empresas-unidades-acesso.md). As permissões são resolvidas por vínculo da empresa e unidade selecionada, e os dados existentes foram identificados como Sourad.
