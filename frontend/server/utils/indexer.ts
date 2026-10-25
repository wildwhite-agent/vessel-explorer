export function getIndexerUrl() {
  const config = useRuntimeConfig()
  return String(config.indexerUrl || process.env.NUXT_INDEXER_URL || '').replace(/\/$/, '')
}

export function requireIndexerUrl(message = 'indexer is unavailable; set NUXT_INDEXER_URL') {
  const indexerUrl = getIndexerUrl()
  if (!indexerUrl) {
    throw createError({
      statusCode: 503,
      message,
    })
  }
  return indexerUrl
}

export async function fetchIndexerJson(path: string, params?: URLSearchParams) {
  const indexerUrl = requireIndexerUrl()
  const query = params?.toString()
  const response = await fetch(`${indexerUrl}${path}${query ? `?${query}` : ''}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)

  if (!response) {
    throw createError({
      statusCode: 502,
      message: 'indexer request failed',
    })
  }

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      message: `indexer request failed: ${response.statusText}`,
    })
  }

  return await response.json()
}
