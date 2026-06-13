export default defineEventHandler(async (event) => {
  setNoStoreHeaders(event)
  const tokenId = String(getRouterParam(event, 'id') || '')
  if (!/^\d+$/.test(tokenId)) {
    throw createError({
      statusCode: 400,
      message: 'invalid token id',
    })
  }

  const data = await fetchIndexerJson(`/tokens/${tokenId}`)
  return await applyTokenDetailTraitFallback(data)
})
