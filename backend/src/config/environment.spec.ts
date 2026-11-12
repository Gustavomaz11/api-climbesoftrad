import { resolve } from 'node:path'
import { validateEnvironment } from './environment'

const productionEnvironment = () => ({
  NODE_ENV: 'production',
  PORT: 3000,
  CLOUDFLARE_R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  CLOUDFLARE_R2_BUCKET: 'test-bucket',
  CLOUDFLARE_R2_ACCESS_KEY: 'access-key',
  CLOUDFLARE_R2_SECRET_KEY: 'secret-key',
  DATABASE_URL: 'postgresql://crm:password@database:5432/crm',
  FRONTEND_ORIGIN: 'https://portal.example.com',
  OAUTH_CLIENT_ID: 'crm-web',
  JWT_ISSUER: 'crm-api',
  JWT_AUDIENCE: 'crm-web',
  JWT_PRIVATE_KEY_PATH: resolve(__dirname, '../../secrets/jwt_private.pem'),
  JWT_PUBLIC_KEY_PATH: resolve(__dirname, '../../secrets/jwt_public.pem'),
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'a-production-password',
  COOKIE_SECURE: true,
  COOKIE_SAME_SITE: 'strict',
})

describe('environment security validation', () => {
  it('requires an API key and a valid sender when Resend is selected', () => {
    expect(() => validateEnvironment({ ...productionEnvironment(), EMAIL_PROVIDER: 'RESEND' })).toThrow('API_RESEND_KEY')
    expect(() => validateEnvironment({ ...productionEnvironment(), EMAIL_PROVIDER: 'RESEND', API_RESEND_KEY: 're_synthetic_only', EMAIL_FROM: 'invalid' })).toThrow('EMAIL_FROM')
    expect(validateEnvironment({ ...productionEnvironment(), EMAIL_PROVIDER: 'RESEND', API_RESEND_KEY: 're_synthetic_only', EMAIL_FROM: 'access@example.com' })).toMatchObject({ EMAIL_PROVIDER: 'RESEND', SMTP_ENABLED: false })
  })
  it('requires secure cookies in production', () => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment(), COOKIE_SECURE: false }),
    ).toThrow('COOKIE_SECURE deve ser true em produÃ§Ã£o.')
  })

  it('requires an HTTPS frontend origin in production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment(),
        FRONTEND_ORIGIN: 'http://portal.example.com',
      }),
    ).toThrow('FRONTEND_ORIGIN deve usar HTTPS em produÃ§Ã£o.')
  })

  it('rejects origins containing paths', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment(),
        FRONTEND_ORIGIN: 'https://portal.example.com/dashboard',
      }),
    ).toThrow('FRONTEND_ORIGIN deve conter somente origens HTTP(S), sem caminhos')
  })
})
