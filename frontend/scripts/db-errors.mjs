export function explainDatabaseError(error) {
  if (error?.code === 'ENOTFOUND') {
    return `database host not found: ${error.hostname}. Check the Supabase connection string host and region.`
  }

  if (error?.code === 'ECONNREFUSED') {
    return 'database connection refused. Check the host, port, and whether the database is reachable.'
  }

  if (error?.code === '28P01') {
    return 'database authentication failed. Check the database password in DATABASE_URL.'
  }

  if (error?.code === '3D000') {
    return 'database name not found. Check the database path at the end of DATABASE_URL.'
  }

  return error?.message || String(error)
}
