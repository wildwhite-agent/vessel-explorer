import { assertMethod, defineEventHandler, getRouterParam, setResponseHeaders } from 'h3'
import { requireVesselId } from '../../utils/media-limits.ts'
import { admitMediaRequest } from '../../utils/bounded-work.ts'
import { getVesselPreview } from '../../utils/vessel-preview.ts'

export default defineEventHandler(async event => {
  assertMethod(event, ['GET', 'HEAD'])
  const id = requireVesselId(getRouterParam(event, 'id'))
  admitMediaRequest(event)
  const image = await getVesselPreview(event, id)
  setResponseHeaders(event, {
    'Content-Type': image.mime,
    'Content-Length': image.bytes.byteLength,
    'Cache-Control': `public, max-age=${image.maxAge}`,
    'X-Content-Type-Options': 'nosniff',
  })
  return image.bytes
})
