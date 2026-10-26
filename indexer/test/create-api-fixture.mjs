// Generate an empty schema from the actual Ponder table definitions for a local
// `ponder serve` smoke test. No RPC, indexing handlers, or production data.
import { createRequire } from 'node:module'
import { Pool } from 'pg'
const require = createRequire(import.meta.resolve('ponder'))
const { getTableConfig } = require('drizzle-orm/pg-core')
globalThis.PONDER_NAMESPACE_BUILD = { schema: 'vessel', viewsSchema: undefined }
const tables = await import('../ponder.schema.ts')
const pool = new Pool({ connectionString: 'postgresql://vessel_indexer@127.0.0.1:55471/vessel' })
const quote = value => '"' + value.replaceAll('"', '""') + '"'
try {
  for (const table of Object.values(tables)) {
    const config = getTableConfig(table)
    const columns = config.columns.map(column => `${quote(column.name)} ${column.getSQLType()}${column.notNull ? ' NOT NULL' : ''}`)
    await pool.query(`CREATE TABLE vessel.${quote(config.name)} (${columns.join(', ')})`)
  }
  await pool.query('CREATE TABLE vessel._ponder_meta (key text PRIMARY KEY, value jsonb NOT NULL)')
  await pool.query("INSERT INTO vessel._ponder_meta VALUES ('app', '{\"is_ready\":1}')")
  console.log('Empty Ponder API fixture created')
} finally { await pool.end() }
