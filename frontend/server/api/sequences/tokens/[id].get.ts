export default defineEventHandler(async (event) => {
  setNoStoreHeaders(event)
  const sequenceId = String(getRouterParam(event, 'id') || '')
  if (!/^\d+$/.test(sequenceId)) {
    throw createError({
      statusCode: 400,
      message: 'invalid sequence id',
    })
  }

  return await fetchIndexerJson(`/sequences/tokens/${sequenceId}`)
})
