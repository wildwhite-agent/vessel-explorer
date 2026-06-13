export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const asset = getRouterParam(event, 'asset')
  if (!id || !/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, message: 'invalid sequence id' })
  }
  if (asset !== 'image' && asset !== 'animation') {
    throw createError({ statusCode: 400, message: 'invalid sequence asset' })
  }

  const media = await loadSequenceMediaAsset(event, id, asset)
  setResponseHeaders(event, {
    'Content-Type': media.mime,
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  })

  return media.bytes
})
