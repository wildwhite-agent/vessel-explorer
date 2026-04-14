import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import postgres from 'postgres'
import { explainDatabaseError } from './db-errors.mjs'
import { loadEnvFile } from './load-env.mjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
await loadEnvFile(join(rootDir, '.env'))

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const schemaPath = join(rootDir, 'db', '001_init.sql')
const schema = await readFile(schemaPath, 'utf8')
const sql = postgres(databaseUrl, { max: 1, prepare: false })

try {
  await sql.unsafe(schema)
  console.log('database schema is ready')
} catch (e) {
  console.error(explainDatabaseError(e))
  process.exitCode = 1
} finally {
  await sql.end()
}
