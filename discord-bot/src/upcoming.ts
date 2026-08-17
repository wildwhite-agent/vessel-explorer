import type { StartMode } from './config.js'
import { announcementKey } from './convex.js'
import type { BotState, UpcomingAnnouncement } from './types.js'

const MAX_SEEN_KEYS = 5_000

export interface ProcessUpcomingOptions {
  startMode: StartMode
  send: (announcement: UpcomingAnnouncement) => Promise<void>
  save: (state: BotState) => Promise<void>
}

export async function processUpcomingAnnouncements(
  state: BotState,
  announcements: UpcomingAnnouncement[],
  options: ProcessUpcomingOptions,
) {
  const ordered = [...announcements].sort(compareAnnouncements)

  if (state.upcomingSeenKeys === undefined && options.startMode === 'latest') {
    const nextState = {
      ...state,
      upcomingSeenKeys: ordered.map(announcementKey),
    }
    await options.save(nextState)
    return nextState
  }

  const seen = new Set(state.upcomingSeenKeys ?? [])
  let nextState = state
  for (const announcement of ordered) {
    const key = announcementKey(announcement)
    if (seen.has(key)) continue
    await options.send(announcement)
    seen.add(key)
    nextState = {
      ...nextState,
      upcomingSeenKeys: capSeenKeys([...seen], key),
    }
    await options.save(nextState)
  }
  return nextState
}

function compareAnnouncements(left: UpcomingAnnouncement, right: UpcomingAnnouncement) {
  const leftTime = left.creationTime ?? Number.MAX_SAFE_INTEGER
  const rightTime = right.creationTime ?? Number.MAX_SAFE_INTEGER
  if (leftTime !== rightTime) return leftTime - rightTime
  return left.id.localeCompare(right.id)
}

function capSeenKeys(keys: string[], newestKey: string) {
  if (keys.length <= MAX_SEEN_KEYS) return keys
  const withoutNewest = keys.filter((key) => key !== newestKey)
  return [...withoutNewest.slice(withoutNewest.length - (MAX_SEEN_KEYS - 1)), newestKey]
}
