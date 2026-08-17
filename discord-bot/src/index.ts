import { pathToFileURL } from 'node:url'
import { isUpcomingPollerEnabled, loadConfig } from './config.js'
import { processActivities, type ActivityNotification } from './bot.js'
import { fetchUpcomingAnnouncements } from './convex.js'
import { buildDiscordPayload, buildUpcomingProjectPayload, sendWithRetry } from './discord.js'
import { createEnsResolver, type EnsResolver } from './ens.js'
import { fetchActivity, fetchAllActivity, fetchStats } from './indexer.js'
import { readState, writeState } from './state.js'
import { processDailySummary } from './summary.js'
import { processUpcomingAnnouncements } from './upcoming.js'
import type { Config } from './config.js'
import type { BotState, UpcomingAnnouncement } from './types.js'

let config: Config | null = null
let ensResolver: EnsResolver | null = null
let sendLatestOnStartPending = true
let sendLatestDailySummaryOnStartPending = true

let shuttingDown = false
process.on('SIGINT', () => {
  shuttingDown = true
})
process.on('SIGTERM', () => {
  shuttingDown = true
})

if (isEntrypoint()) {
  await run()
}

async function run() {
  const activeConfig = getConfig()
  console.log('vessel discord bot starting')
  let state = await readState(activeConfig.stateFile)

  while (!shuttingDown) {
    try {
      state = await pollOnce(state)
    } catch (error) {
      console.error('poll failed', error)
    }
    try {
      state = await pollUpcomingOnce(state)
    } catch (error) {
      console.error('upcoming project poll failed', error)
    }
    try {
      state = await summarizeOnce(state)
    } catch (error) {
      console.error('daily summary failed', error)
    }
    await sleep(activeConfig.pollIntervalMs)
  }

  console.log('vessel discord bot stopped')
}

export async function pollOnce(state: BotState): Promise<BotState> {
  const activeConfig = getConfig()
  const activities = await fetchActivity(activeConfig.indexerUrl, 100)
  const shouldSendLatestOnStart = activeConfig.sendLatestOnStart && sendLatestOnStartPending
  const nextState = await processActivities(state, activities, {
    excludedEventTypes: activeConfig.excludedEventTypes,
    startMode: activeConfig.startMode,
    sendLatestOnStart: shouldSendLatestOnStart,
    send: sendActivity,
    save: (nextState) => writeState(activeConfig.stateFile, nextState),
  })
  if (shouldSendLatestOnStart) {
    sendLatestOnStartPending = false
  }
  return nextState
}

export async function pollUpcomingOnce(state: BotState): Promise<BotState> {
  const activeConfig = getConfig()
  if (!isUpcomingPollerEnabled(activeConfig)) return state

  const announcements = await fetchUpcomingAnnouncements(
    activeConfig.convexUrl,
    activeConfig.convexUpcomingQuery,
  )
  return await processUpcomingAnnouncements(state, announcements, {
    startMode: activeConfig.startMode,
    send: sendUpcomingProject,
    save: (nextState) => writeState(activeConfig.stateFile, nextState),
  })
}

export async function summarizeOnce(state: BotState): Promise<BotState> {
  const activeConfig = getConfig()
  const shouldSendLatestSummaryOnStart = activeConfig.dailySummarySendLatestOnStart
    && sendLatestDailySummaryOnStartPending
  let sentSummaryEnd: number | null = null
  const nextState = await processDailySummary(state, {
    schedule: {
      enabled: activeConfig.dailySummaryEnabled,
      timeZone: activeConfig.dailySummaryTimeZone,
      hour: activeConfig.dailySummaryHour,
      minute: activeConfig.dailySummaryMinute,
      windowHours: activeConfig.dailySummaryWindowHours,
      deployedAt: activeConfig.vesselDeployedAt,
    },
    excludedEventTypes: activeConfig.excludedEventTypes,
    vesselBaseUrl: activeConfig.vesselBaseUrl,
    gridCacheBust: shouldSendLatestSummaryOnStart ? String(Date.now()) : undefined,
    fetchActivities: (options) => fetchAllActivity(activeConfig.indexerUrl, options),
    fetchStats: () => fetchStats(activeConfig.indexerUrl),
    send: (payload) => sendWithRetry(activeConfig.discordWebhookUrl, payload),
    save: (nextState) => writeState(activeConfig.stateFile, nextState),
    forceLatest: shouldSendLatestSummaryOnStart,
    onSent: (window) => {
      sentSummaryEnd = window.endTime
    },
  })
  if (shouldSendLatestSummaryOnStart && sentSummaryEnd !== null) {
    sendLatestDailySummaryOnStartPending = false
  }
  if (sentSummaryEnd !== null) {
    console.log(`sent daily summary through ${sentSummaryEnd}`)
  }
  return nextState
}

async function sendActivity(activities: ActivityNotification) {
  const activeConfig = getConfig()
  const resolver = getEnsResolver()
  const activity = activities[0]!
  const actorAddress = activity.action.toLowerCase() === 'sale'
    ? activity.buyer || activity.from
    : activity.from
  const [actor, seller] = await Promise.all([
    resolver.displayName(actorAddress),
    activity.action.toLowerCase() === 'sale' && activity.seller
      ? resolver.displayName(activity.seller)
      : Promise.resolve(undefined),
  ])
  const payload = buildDiscordPayload(activities, activeConfig.vesselBaseUrl, { actor, seller })
  await sendWithRetry(activeConfig.discordWebhookUrl, payload)
  const subject = activity.vesselId ?? activity.subjectId ?? ''
  const count = activities.length > 1 ? ` (${activities.length} rows)` : ''
  console.log(`sent ${activity.action} #${subject} ${activity.hash}${count}`)
}

async function sendUpcomingProject(announcement: UpcomingAnnouncement) {
  const activeConfig = getConfig()
  const payload = buildUpcomingProjectPayload(announcement, activeConfig.visualizerBaseUrl)
  await sendWithRetry(activeConfig.discordProjectWebhookUrl, payload)
  console.log(`sent upcoming project ${announcement.title}`)
}

function getConfig() {
  config ??= loadConfig()
  return config
}

function getEnsResolver() {
  ensResolver ??= createEnsResolver(getConfig().ethRpcUrl)
  return ensResolver
}

function isEntrypoint() {
  const entrypoint = process.argv[1]
  return Boolean(entrypoint && import.meta.url === pathToFileURL(entrypoint).href)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
