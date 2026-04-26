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
    const rows = await sql.unsafe(
      `select id from tokens where claimed = true order by id asc`,
    )

    const ids = rows.map((r: any) => Number(r.id))

    return {
      ids,
      total: ids.length,
      source: 'database' as const,
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