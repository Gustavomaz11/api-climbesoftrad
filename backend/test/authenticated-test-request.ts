import { createHash, randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import request from 'supertest'
import { responseBody } from './operational-documents.fixture'
import { initialCompanyId } from '../src/database/migrations/schema/legacy-company-mapping'
export const authenticatedTestRequest = async (
  server: Server,
  identifier: string,
  password: string,
) => {
  const verifier = randomBytes(64).toString('base64url')
  const login = await request(server)
    .post('/api/v1/auth/login')
    .send({
      email: identifier,
      password,
      clientId: 'crm-web',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
      state: randomBytes(32).toString('base64url'),
      remember: false,
    })
    .expect(200)
  const exchange = await request(server)
    .post('/api/v1/auth/token')
    .set('Origin', 'http://localhost:5173')
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      grantType: 'authorization_code',
      clientId: 'crm-web',
      authorizationCode: responseBody<{ authorizationCode: string }>(login).authorizationCode,
      codeVerifier: verifier,
    })
    .expect(200)
  const token = responseBody<{ accessToken: string }>(exchange).accessToken
  return (method: 'get' | 'post' | 'put' | 'patch', path: string) =>
    request(server)
      [method]('/api/v1' + path)
      .set('Authorization', 'Bearer ' + token)
      .set('X-Company-Id', initialCompanyId)
}
