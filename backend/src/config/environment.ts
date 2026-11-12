import { existsSync } from 'node:fs'
import Joi from 'joi'

export type CookieSameSite = 'strict' | 'lax' | 'none'

const environmentSchema = Joi.object({
  EMAIL_PROVIDER: Joi.string().valid('SMTP', 'RESEND').default('SMTP'),
  API_RESEND_KEY: Joi.string().when('EMAIL_PROVIDER', { is: 'RESEND', then: Joi.string().pattern(/^re_[A-Za-z0-9_-]+$/).required(), otherwise: Joi.allow('').default('') }),
  EMAIL_FROM: Joi.string().email().when('EMAIL_PROVIDER', { is: 'RESEND', then: Joi.required(), otherwise: Joi.allow('').default('') }),
  EMAIL_REPLY_TO: Joi.string().email().allow('').default(''),
  SMTP_ENABLED: Joi.boolean().default(false),
  SMTP_HOST: Joi.string().hostname().when('SMTP_ENABLED', { is: true, then: Joi.required(), otherwise: Joi.allow('').default('') }),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().when('SMTP_ENABLED', { is: true, then: Joi.required(), otherwise: Joi.allow('').default('') }),
  SMTP_PASSWORD: Joi.string().when('SMTP_ENABLED', { is: true, then: Joi.required(), otherwise: Joi.allow('').default('') }),
  SMTP_FROM: Joi.string().email().when('SMTP_ENABLED', { is: true, then: Joi.required(), otherwise: Joi.allow('').default('') }),
  CNPJA: Joi.string().allow('').default(''),
  ROUTER_PUBLIC_API_URL: Joi.string().uri({ scheme: ['https'] }).allow('').default(''),
  ROUTER_TLS_PORT: Joi.number().port().default(3443),
  ROUTER_TLS_KEY_PATH: Joi.string().allow('').default(''),
  ROUTER_TLS_CERT_PATH: Joi.string().allow('').default(''),
  ROUTER_INSTALLER_ROOT: Joi.string().default('../instalavel'),
  ROUTER_CREDENTIAL_SECRET: Joi.string().min(32).allow('').default(''),
  GEMINI_API_KEY: Joi.string().allow('').default(''),
  GEMINI_RESEARCH_ENABLED: Joi.boolean().default(false),
  GEMINI_RESEARCH_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).max(240000).default(120000),
  GEMINI_RESEARCH_MODEL: Joi.string().pattern(/^[a-zA-Z0-9._-]+$/).max(100).default('gemini-3.5-flash-lite'),
  GEMINI_RESEARCH_MAX_FRAMES: Joi.number().integer().min(1).max(2000).default(200),
  GEMINI_RESEARCH_IMAGES_PER_REQUEST: Joi.number().integer().min(1).max(4).default(1),
  SOURAD_WEB_URL: Joi.string().uri({scheme:['http','https']}).default('http://localhost:5173'),
  SOURAD_CENTRAL_COMPANY_ID: Joi.string().guid().default('00000000-0000-4000-8000-000000000001'),
  DIRECTD_CFM_URL: Joi.string().uri({ scheme: ['https'] }).default('https://apiv3.directd.com.br/api/ConselhoFederalMedicina'),
  DIRECTD_CFM_TOKEN: Joi.string().allow('').default(''),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  UPLOAD_DOCUMENT_MAX_BYTES: Joi.number().integer().min(1).max(100*1024*1024).default(50*1024*1024),
  UPLOAD_DICOM_MAX_BYTES: Joi.number().integer().min(1).max(2147483647).default(1024*1024*1024),
  UPLOAD_SESSION_HOURS: Joi.number().integer().min(1).max(48).default(24),
  UPLOAD_BROWSER_TRANSPORT:Joi.string().valid('API','DIRECT').default('API'),
  CLAMAV_HOST: Joi.string().hostname().allow('').default(''),
  CLAMAV_PORT: Joi.number().port().default(3310),
  ORTHANC_INTERNAL_URL: Joi.string().uri({ scheme: ['http','https'] }).allow('').default(''),
  ORTHANC_USERNAME: Joi.string().allow('').default(''),
  ORTHANC_PASSWORD: Joi.string().allow('').default(''),
  OHIF_VIEWER_URL: Joi.string().uri({ scheme: ['http','https'] }).allow('').default(''),
  PUBLIC_API_URL: Joi.string().uri({ scheme: ['http','https'] }).allow('').default(''),
  CLOUDFLARE_R2_ENDPOINT: Joi.string().uri().when('NODE_ENV', {
    is: 'test',
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  CLOUDFLARE_R2_BUCKET: Joi.string().min(1).when('NODE_ENV', {
    is: 'test',
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  CLOUDFLARE_R2_PUBLIC_URL: Joi.string().uri().allow('').optional(),
  CLOUDFLARE_R2_REGION: Joi.string().default('auto'),
  OBJECT_STORAGE_FORCE_PATH_STYLE: Joi.boolean().default(false),
  CLOUDFLARE_R2_ACCESS_KEY: Joi.string().min(1).when('NODE_ENV', {
    is: 'test',
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  CLOUDFLARE_R2_SECRET_KEY: Joi.string().min(1).when('NODE_ENV', {
    is: 'test',
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  FRONTEND_ORIGIN: Joi.string().required(),
  OAUTH_CLIENT_ID: Joi.string().min(3).max(100).required(),
  JWT_ISSUER: Joi.string().min(3).required(),
  JWT_AUDIENCE: Joi.string().min(3).required(),
  JWT_PRIVATE_KEY_PATH: Joi.string().required(),
  JWT_PUBLIC_KEY_PATH: Joi.string().required(),
  ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).default(600),
  AUTHORIZATION_CODE_TTL_SECONDS: Joi.number().integer().min(30).max(300).default(60),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(90).default(30),
  MAX_FAILED_LOGIN_ATTEMPTS: Joi.number().integer().min(3).max(20).default(5),
  ACCOUNT_LOCKOUT_SECONDS: Joi.number().integer().min(60).max(86400).default(900),
  RATE_LIMIT_BURST_WINDOW_SECONDS: Joi.number().integer().min(1).max(60).default(10),
  RATE_LIMIT_BURST_REQUESTS: Joi.number().integer().min(5).max(500).default(30),
  RATE_LIMIT_STANDARD_WINDOW_SECONDS: Joi.number().integer().min(10).max(3600).default(60),
  RATE_LIMIT_STANDARD_REQUESTS: Joi.number().integer().min(10).max(10000).default(120),
  RATE_LIMIT_SUSTAINED_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(86400)
    .default(900),
  RATE_LIMIT_SUSTAINED_REQUESTS: Joi.number()
    .integer()
    .min(100)
    .max(100000)
    .default(1000),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10).default(0),
  PUBLIC_REGISTRATION_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  ADMIN_EMAIL: Joi.string().email().required(),
  ADMIN_PASSWORD: Joi.string().min(12).max(128).required(),
  COOKIE_SECURE: Joi.boolean().truthy('true').falsy('false').default(true),
  COOKIE_SAME_SITE: Joi.string().valid('strict', 'lax', 'none').default('strict'),
  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
}).unknown(true)

export const validateEnvironment = (rawEnvironment: Record<string, unknown>) => {
  const validation = environmentSchema.validate(rawEnvironment, {
    abortEarly: false,
    convert: true,
  }) as { error?: Error; value: Record<string, unknown> }

  if (validation.error) {
    throw new Error(`Configuração de ambiente inválida: ${validation.error.message}`)
  }

  const environment = validation.value
  const databaseName = decodeURIComponent(new URL(String(environment.DATABASE_URL)).pathname.slice(1))
  const privateKeyPath = String(environment.JWT_PRIVATE_KEY_PATH)
  const publicKeyPath = String(environment.JWT_PUBLIC_KEY_PATH)

  if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
    throw new Error('Os arquivos de chave JWT configurados não foram encontrados.')
  }

  if (environment.NODE_ENV === 'test' && !databaseName.endsWith('_test')) {
    throw new Error('O banco configurado para testes deve terminar com o sufixo _test.')
  }

  if (environment.COOKIE_SAME_SITE === 'none' && environment.COOKIE_SECURE !== true) {
    throw new Error('COOKIE_SECURE deve ser true quando COOKIE_SAME_SITE=none.')
  }

  const allowedOrigins = parseAllowedOrigins(String(environment.FRONTEND_ORIGIN))
  if (allowedOrigins.length === 0) {
    throw new Error('FRONTEND_ORIGIN deve informar ao menos uma origem permitida.')
  }

  for (const origin of allowedOrigins) {
    let parsedOrigin: URL
    try {
      parsedOrigin = new URL(origin)
    } catch {
      throw new Error(`FRONTEND_ORIGIN contÃ©m uma origem invÃ¡lida: ${origin}`)
    }

    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
      throw new Error(`FRONTEND_ORIGIN deve conter somente origens HTTP(S), sem caminhos: ${origin}`)
    }

    if (environment.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') {
      throw new Error('FRONTEND_ORIGIN deve usar HTTPS em produÃ§Ã£o.')
    }
  }

  if (environment.NODE_ENV === 'production' && environment.COOKIE_SECURE !== true) {
    throw new Error('COOKIE_SECURE deve ser true em produÃ§Ã£o.')
  }

  return environment
}

export const parseAllowedOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
