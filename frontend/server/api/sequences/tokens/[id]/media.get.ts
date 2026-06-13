export default defineEventHandler(async (event) => {
  setNoStoreHeaders(event)
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, message: 'invalid sequence id' })
  }

  const metadata = await loadSequenceMetadata(event, id)
  const [image, animation] = await Promise.all([
    metadata.imageUri
      ? inspectSequenceMediaAsset(id, 'image', metadata.imageUri).catch(() => null)
      : null,
    metadata.animationUri
      ? inspectSequenceMediaAsset(id, 'animation', metadata.animationUri).catch(() => null)
      : null,
  ])

  return {
    tokenId: id,
    name: metadata.name,
    description: metadata.description,
    image,
    animation,
    preferred: animation || image,
  }
})
