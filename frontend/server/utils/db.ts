import postgres, { type Sql } from 'postgres'

let client: Sql | null = null

export function getDatabase(): Sql | null {
  const config = useRuntimeConfig()
  const databaseUrl = config.databaseUrl || process.env.DATABASE_URL

  if (!databaseUrl) return null
  if (!client) {
    client = postgres(databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    })
  }

  return client
}
