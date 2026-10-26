import { grid } from '@visualizevalue/img-grid'
import { assertMethod, createError, defineEventHandler, getQuery, setResponseHeaders, type H3Event } from 'h3'
import { BoundedWorkCache, admitMediaRequest } from '../utils/bounded-work.ts'
import { getVesselPreview } from '../utils/vessel-preview.ts'
import { requireVesselId } from '../utils/media-limits.ts'
import { mediaRevisionKey } from '../utils/media-revision.ts'

const DAILY_GRID_CACHE_SECONDS = 3600
const PAGE_LIMIT = 1000
const MAX_CELLS = 256
const MAX_PAGES = 10
const grids = new BoundedWorkCache<Uint8Array>(1, 8, 16 * 1024 * 1024)

interface ActivityRow {
  action?: string
  functionName?: string
  vesselId?: string | number | null
  _vesselId?: string | number | null
}

export default defineEventHandler(async (event) => {
  assertMethod(event, ['GET', 'HEAD'])
  const { start, end } = parseWindow(event)
  admitMediaRequest(event)
  const png = await grids.get(`${start}:${end}:${mediaRevisionKey(event)}`, async () => {
    const vesselIds = await touchedVesselIds(start, end)
    const images: { id: string; url: string }[] = []
    const deadline = Date.now() + 30_000
    let inputBytes = 0
    // Call the bounded helper directly: self-HTTP requests would consume the
    // client rate budget and reject cold grid cells at the preview concurrency cap.
    for (const id of vesselIds) {
      if (Date.now() > deadline) throw createError({ statusCode: 504, message: 'daily grid time limit exceeded' })
      try {
        const image = await getVesselPreview(event, Number(id))
        inputBytes += image.bytes.byteLength
        if (inputBytes > 16 * 1024 * 1024) throw createError({ statusCode: 422, message: 'daily grid input limit exceeded' })
        images.push({ id, url: `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}` })
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) continue
        throw error
      }
    }
    if (!images.length) throw createError({ statusCode: 404, message: 'daily grid is empty' })
    return grid(images, {
      maxWidth: 1600,
      padding: 24,
      gutter: 8,
      background: '#000',
      pixelated: true,
      format: 'png',
      concurrency: 4,
      // All inputs were rendered locally; an unexpected decode failure must not
      // turn an incomplete social image into a successful cached response.
      onError: () => { throw createError({ statusCode: 502, message: 'daily grid image failed' }) },
    })
  }, DAILY_GRID_CACHE_SECONDS * 1000, bytes => bytes.byteLength)
  setResponseHeaders(event, {
    'Content-Type': 'image/png',
    'Content-Length': png.byteLength,
    'Cache-Control': `public, max-age=${DAILY_GRID_CACHE_SECONDS}, s-maxage=${DAILY_GRID_CACHE_SECONDS}`,
  })
  return png
})

function parseWindow(event: H3Event) {
  const query = getQuery(event)
  const start = positiveInteger(query.start)
  const end = positiveInteger(query.end)

  if (start == null || end == null || end <= start || end - start > 7 * 86400) {
    throw createError({ statusCode: 400, message: 'start and end must define a window of at most 7 days' })
  }

  return { start, end }
}

async function touchedVesselIds(start: number, end: number) {
  const seen = new Set<string>()

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      startTime: String(start),
      endTime: String(end),
      limit: String(PAGE_LIMIT),
      page: String(page),
    })
    const rows = await fetchIndexerJson('/activity', params) as ActivityRow[]

    for (const row of rows) {
      if (!isIncludedActivity(row)) continue
      const vesselId = normalizeVesselId(row.vesselId ?? row._vesselId)
      if (vesselId) seen.add(vesselId)
      if (seen.size > MAX_CELLS) throw createError({ statusCode: 422, message: 'daily grid cell limit exceeded' })
    }

    if (rows.length < PAGE_LIMIT) break
    if (page === MAX_PAGES) throw createError({ statusCode: 422, message: 'daily grid activity limit exceeded' })
  }

  return [...seen].sort((a, b) => Number(a) - Number(b))
}

function isIncludedActivity(row: ActivityRow) {
  const vesselId = normalizeVesselId(row.vesselId ?? row._vesselId)
  if (!vesselId) return false

  const action = String(row.action || '').toLowerCase()
  if (action === 'transfer' || action === 'metadata') return false

  const functionName = String(row.functionName || '').toLowerCase()
  if (functionName.startsWith('refreshmetadata')) return false

  return true
}

function normalizeVesselId(value: unknown) {
  if (value == null) return ''
  try { return String(requireVesselId(String(value))) } catch { return '' }
}

function positiveInteger(value: unknown) {
  if (Array.isArray(value)) return positiveInteger(value[0])
  if (value == null || !/^\d+$/.test(String(value))) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
