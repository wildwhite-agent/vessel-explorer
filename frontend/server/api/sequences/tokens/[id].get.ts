export default defineEventHandler(async (event) => {
  setNoStoreHeaders(event)
  const sequenceId = requireSequenceId(getRouterParam(event, 'id'))

  return await fetchIndexerJson(`/sequences/tokens/${sequenceId}`)
})
