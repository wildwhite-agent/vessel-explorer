import { mediaRevisionKey } from '../../utils/media-revision'
import { sequencePoster } from '../../utils/sequence-poster'
import { BoundedWorkCache, admitMediaRequest } from '../../utils/bounded-work'

const posters = new BoundedWorkCache<Uint8Array>(2, 64, 16 * 1024 * 1024)

export default defineEventHandler(async event => {
  assertMethod(event, ['GET', 'HEAD'])
  const id = requireSequenceId(getRouterParam(event, 'id'))
  admitMediaRequest(event)
  const bytes = await posters.get(`${id}:${mediaRevisionKey(event)}`, async () => {
    const token = await fetchIndexerJson(`/sequences/tokens/${id}`)
    if (!token) throw createError({ statusCode: 404, message: 'sequence not found' })
    const fallback = await useStorage('assets:server').getItemRaw('sequence-poster.png')
    return sequencePoster(await loadSequenceMediaAsset(event, id, 'image'), fallback)
  }, 300_000, bytes => bytes.byteLength)
  setResponseHeaders(event, {
    'Content-Type': 'image/png',
    'Content-Length': bytes.byteLength,
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  })
  return bytes
})
