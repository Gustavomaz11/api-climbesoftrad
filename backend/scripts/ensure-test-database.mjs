import { config } from 'dotenv'
import pg from 'pg'

config({ path: ['.env.test', '.env'], quiet: true })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL não está configurada para os testes.')
}

const targetUrl = new URL(databaseUrl)
const databaseName = decodeURIComponent(targetUrl.pathname.slice(1))

if (!/^[A-Za-z0-9_]+_test$/.test(databaseName)) {
  throw new Error('O banco de testes deve terminar com o sufixo _test.')
}

const adminUrl = new URL(targetUrl)
adminUrl.pathname = '/postgres'

const client = new pg.Client({ connectionString: adminUrl.toString() })
await client.connect()

try {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName])

  if (result.rowCount === 0) {
    await client.query(`CREATE DATABASE "${databaseName}"`)
  }
} finally {
  await client.end()
}
