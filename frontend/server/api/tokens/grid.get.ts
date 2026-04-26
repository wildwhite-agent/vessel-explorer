import { getDatabase } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const sql = getDatabase()
  if (!sql) {
    throw createError({
      statusCode: 503,
      message: 'database read model is unavailable; set DATABASE_URL and run pnpm db:backfill',
    })
  }

  try {
    const rows = await sql.unsafe(`
      select
        id,
        vessel_type as "type",
        color_mode as "colorMode",
        payload_hex as "payload"
      from tokens
      where claimed = true
      order by id asc
    `)

    const lastUpdated = await sql.unsafe(
      `select value from indexer_state where key = 'tokens_last_indexed_at'`,
    )

    setResponseHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300')

    return {
      tokens: rows,
      lastUpdated: lastUpdated[0]?.value ?? null,
    }
  } catch (e: any) {
    if (e?.code === '42P01') {
      throw createError({
        statusCode: 503,
        message: 'database schema is missing; run pnpm db:schema or pnpm db:backfill',
      })
    }
    throw e
  }
})
