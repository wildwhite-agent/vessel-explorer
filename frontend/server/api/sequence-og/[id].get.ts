export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, message: 'invalid sequence id' })
  }

  const image = await loadSequenceMediaAsset(event, id, 'image')
  setResponseHeaders(event, {
    'Content-Type': image.mime,
    'Cache-Control': 'public, max-age=3600',
  })

  return image.bytes
})
