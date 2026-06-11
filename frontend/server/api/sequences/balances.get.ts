export default defineEventHandler(async (event) => {
  setNoStoreHeaders(event)
  const query = getQuery(event)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
    } else if (value != null) {
      params.set(key, String(value))
    }
  }

  return await fetchIndexerJson('/sequences/balances', params)
})
