import type { UpcomingAnnouncement } from './types.js'

interface ConvexQueryResponse {
  status?: string
  value?: unknown
  errorMessage?: string
}

export async function fetchUpcomingAnnouncements(
  convexUrl: string,
  queryPath: string,
  afterCreatedAt: number,
): Promise<UpcomingAnnouncement[]> {
  if (!Number.isFinite(afterCreatedAt) || afterCreatedAt <= 0) {
    throw new Error('afterCreatedAt must be a positive timestamp; refusing to poll from 0')
  }

  const response = await fetch(`${trimTrailingSlash(convexUrl)}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      path: queryPath,
      args: { afterCreatedAt },
      format: 'json',
    }),
  })

  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Convex query failed: ${response.status} ${response.statusText} ${body}`.trim())
  }

  let parsed: ConvexQueryResponse
  try {
    parsed = JSON.parse(body) as ConvexQueryResponse
  } catch {
    throw new Error(`Convex query returned invalid JSON: ${body.slice(0, 200)}`)
  }

  if (parsed.status !== 'success' || !Array.isArray(parsed.value)) {
    throw new Error(
      parsed.status === 'error' || parsed.errorMessage
        ? `Convex query failed: ${parsed.errorMessage || 'unknown error'}`
        : 'Convex query did not return status "success" with an array',
    )
  }

  return parsed.value.map(normalizeAnnouncement).filter(Boolean) as UpcomingAnnouncement[]
}

export function announcementKey(announcement: UpcomingAnnouncement) {
  return announcement.id
}

export function normalizeAnnouncement(value: unknown): UpcomingAnnouncement | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const title = stringField(row.title)
  const date = stringField(row.date) || stringField(row.releaseDate)
  const artist = stringField(row.artist) || stringField(row.artistName)
  const exploreUrl = stringField(row.exploreUrl) || '/explore'
  if (!title || !artist) return null

  const id = stringField(row._id) || stringField(row.id) || [title, date, artist, exploreUrl].join('|')
  const creationTime = numberField(row.createdAt)
    ?? numberField(row._creationTime)
    ?? numberField(row.creationTime)

  return {
    id,
    title,
    date: date || 'TBD',
    artist,
    exploreUrl,
    creationTime,
  }
}

function stringField(value: unknown) {
  if (value == null) return ''
  return String(value).trim()
}

function numberField(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}
