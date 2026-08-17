import type { BotState, UpcomingAnnouncement } from './types.js'

export interface ProcessUpcomingOptions {
  now?: number
  send: (announcement: UpcomingAnnouncement) => Promise<void>
  save: (state: BotState) => Promise<void>
}

export function upcomingWatermark(state: BotState): number | null {
  return normalizeWatermark(state.upcomingAfterCreatedAt)
}

export async function ensureUpcomingWatermark(
  state: BotState,
  save: (state: BotState) => Promise<void>,
  now = Date.now(),
): Promise<BotState> {
  if (upcomingWatermark(state) != null) return state
  const nextState = { ...state, upcomingAfterCreatedAt: now }
  await save(nextState)
  return nextState
}

export async function processUpcomingAnnouncements(
  state: BotState,
  announcements: UpcomingAnnouncement[],
  options: ProcessUpcomingOptions,
) {
  const watermarked = await ensureUpcomingWatermark(state, options.save, options.now)
  const watermark = upcomingWatermark(watermarked)
  if (watermark == null) return watermarked

  const ordered = [...announcements]
    .filter((announcement) => (announcement.creationTime ?? 0) > watermark)
    .sort(compareAnnouncements)

  if (!ordered.length) return watermarked

  for (const announcement of ordered) {
    await options.send(announcement)
  }

  const maxCreatedAt = ordered.reduce((max, announcement) => {
    const createdAt = announcement.creationTime
    return createdAt != null && createdAt > max ? createdAt : max
  }, watermark)

  const nextState = { ...watermarked, upcomingAfterCreatedAt: maxCreatedAt }
  await options.save(nextState)
  return nextState
}

export function normalizeWatermark(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.floor(value)
}

function compareAnnouncements(left: UpcomingAnnouncement, right: UpcomingAnnouncement) {
  const leftTime = left.creationTime ?? Number.MAX_SAFE_INTEGER
  const rightTime = right.creationTime ?? Number.MAX_SAFE_INTEGER
  if (leftTime !== rightTime) return leftTime - rightTime
  return left.id.localeCompare(right.id)
}
