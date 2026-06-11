import { isIncludedActivity, type FetchActivityOptions } from './indexer.js'
import type { DiscordEmbedPayload } from './discord.js'
import type { BotState, ProtocolStats, VesselActivity } from './types.js'

export interface SummarySchedule {
  enabled: boolean
  timeZone: string
  hour: number
  minute: number
  windowHours: number
  deployedAt: Date
}

export interface SummaryWindow {
  startTime: number
  endTime: number
  dayNumber: number
  label: string
}

export interface ProcessDailySummaryOptions {
  schedule: SummarySchedule
  excludedEventTypes: Set<string>
  vesselBaseUrl: string
  gridCacheBust?: string
  fetchActivities: (options: Omit<FetchActivityOptions, 'page'>) => Promise<VesselActivity[]>
  fetchStats: () => Promise<ProtocolStats>
  send: (payload: DiscordEmbedPayload) => Promise<void>
  save: (state: BotState) => Promise<void>
  now?: Date
  forceLatest?: boolean
  onSent?: (window: SummaryWindow) => void
}

interface DateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export async function processDailySummary(
  state: BotState,
  options: ProcessDailySummaryOptions,
) {
  const window = latestDueSummaryWindow(options.schedule, state, options.now ?? new Date(), {
    forceLatest: options.forceLatest ?? false,
  })
  if (!window) return state

  const [activityRows, stats] = await Promise.all([
    options.fetchActivities({
      limit: 1000,
      startTime: window.startTime,
      endTime: window.endTime,
    }),
    options.fetchStats(),
  ])

  const activities = activityRows.filter((activity) =>
    isIncludedActivity(activity, options.excludedEventTypes),
  )
  const payload = buildDailySummaryPayload(window, activities, stats, options.vesselBaseUrl, {
    gridCacheBust: options.gridCacheBust,
  })
  await options.send(payload)

  const nextState = {
    ...state,
    lastSummaryWindowEnd: window.endTime,
    ...(options.forceLatest ? { lastForcedSummaryWindowEnd: window.endTime } : {}),
  }
  await options.save(nextState)
  options.onSent?.(window)
  return nextState
}

export function latestDueSummaryWindow(
  schedule: SummarySchedule,
  state: Pick<BotState, 'lastSummaryWindowEnd'> & { lastForcedSummaryWindowEnd?: number | null },
  now: Date,
  options: { forceLatest?: boolean } = {},
): SummaryWindow | null {
  if (!schedule.enabled) return null

  const latestEnd = latestScheduledEnd(now, schedule)
  const firstEnd = firstScheduledEndAfterDeploy(schedule)
  if (latestEnd.getTime() < firstEnd.getTime()) return null

  const endTime = Math.floor(latestEnd.getTime() / 1000)
  if (options.forceLatest) {
    const forcedEnd = state.lastForcedSummaryWindowEnd ?? null
    if (forcedEnd !== null && forcedEnd >= endTime) {
      return null
    }
  } else if (state.lastSummaryWindowEnd !== null && state.lastSummaryWindowEnd >= endTime) {
    return null
  }

  const startTime = endTime - schedule.windowHours * 60 * 60
  return {
    startTime,
    endTime,
    dayNumber: dayNumberForEnd(latestEnd, firstEnd, schedule.timeZone),
    label: formatWindowLabel(startTime, endTime, schedule.timeZone),
  }
}

export function buildDailySummaryPayload(
  window: SummaryWindow,
  activities: VesselActivity[],
  stats: ProtocolStats,
  vesselBaseUrl: string,
  options: { gridCacheBust?: string } = {},
): DiscordEmbedPayload {
  const vesselIds = new Set<string>()
  const actors = new Set<string>()
  const actionCounts = new Map<string, number>()

  for (const activity of activities) {
    if (activity.vesselId) vesselIds.add(activity.vesselId)
    if (activity.from) actors.add(activity.from.toLowerCase())
    const action = activity.action.toLowerCase()
    actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1)
  }

  const activitySummary = activities.length > 0
    ? `${formatNumber(activities.length)} interactions · ${formatNumber(vesselIds.size)} crafts touched · ${formatNumber(actors.size)} actors`
    : 'No vessel interactions.'
  const actions = actionCountsDescription(actionCounts)
  const description = [
    activitySummary,
    actions,
    `***Protocol***\n${protocolStatsValue(stats)}`,
  ].filter(Boolean).join('\n\n')

  return {
    embeds: [
      {
        title: `Day ${window.dayNumber}`,
        description,
        ...(vesselIds.size > 0
          ? { image: { url: dailyGridUrl(vesselBaseUrl, window, options.gridCacheBust) } }
          : {}),
      },
    ],
  }
}

function protocolStatsValue(stats: ProtocolStats) {
  const tokens = stats.tokens
  return [
    `${formatNumber(tokens.claimed)} / ${formatNumber(tokens.total)} claimed · ${formatNumber(tokens.filled)} filled · ${formatNumber(tokens.uniqueHolders)} holders`,
    `${formatNumber(tokens.filledBytes)} / ${formatNumber(tokens.claimedCapacityBytes)} bytes filled`,
  ].join('\n')
}

function actionCountsDescription(actionCounts: Map<string, number>) {
  return [...actionCounts.entries()]
    .sort((a, b) => actionRank(a[0]) - actionRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([action, count]) => `${actionLabel(action)}: ${formatNumber(count)}`)
    .join('\n')
}

function actionRank(action: string) {
  const order = ['claim', 'sale', 'write', 'vwuclaim', 'sequencemint', 'setvaultentry', 'machine', 'delegate']
  const index = order.indexOf(action)
  return index === -1 ? order.length : index
}

function actionLabel(action: string) {
  switch (action) {
    case 'claim':
      return 'Claims'
    case 'sale':
      return 'Sales'
    case 'write':
      return 'Writes'
    case 'vwuclaim':
      return 'VWU Claims'
    case 'sequencemint':
      return 'Sequence Mints'
    case 'setvaultentry':
      return 'SetVaultEntries'
    case 'machine':
      return 'SetMachines'
    case 'delegate':
      return 'SetDelegates'
    case 'approval':
      return 'Approvals'
    case 'approvalforall':
      return 'ApprovalForAll'
    case 'role':
      return 'SetRoles'
    case 'lock':
      return 'LockClocks'
    default:
      return titleCase(action.replace(/[_-]+/g, ' '))
  }
}

function dailyGridUrl(vesselBaseUrl: string, window: SummaryWindow, cacheBust?: string) {
  const url = new URL('/api/daily-grid', trimTrailingSlash(vesselBaseUrl))
  url.searchParams.set('start', String(window.startTime))
  url.searchParams.set('end', String(window.endTime))
  if (cacheBust) {
    url.searchParams.set('v', cacheBust)
  }
  return url.toString()
}

function latestScheduledEnd(now: Date, schedule: SummarySchedule) {
  const today = localDateParts(now, schedule.timeZone)
  let end = zonedDateTimeToUtc({
    ...today,
    hour: schedule.hour,
    minute: schedule.minute,
    second: 0,
  }, schedule.timeZone)

  if (end.getTime() > now.getTime()) {
    const previous = shiftLocalDate(today, -1)
    end = zonedDateTimeToUtc({
      ...previous,
      hour: schedule.hour,
      minute: schedule.minute,
      second: 0,
    }, schedule.timeZone)
  }

  return end
}

function firstScheduledEndAfterDeploy(schedule: SummarySchedule) {
  const deployed = localDateParts(schedule.deployedAt, schedule.timeZone)
  let end = zonedDateTimeToUtc({
    ...deployed,
    hour: schedule.hour,
    minute: schedule.minute,
    second: 0,
  }, schedule.timeZone)

  if (end.getTime() <= schedule.deployedAt.getTime()) {
    const next = shiftLocalDate(deployed, 1)
    end = zonedDateTimeToUtc({
      ...next,
      hour: schedule.hour,
      minute: schedule.minute,
      second: 0,
    }, schedule.timeZone)
  }

  return end
}

function dayNumberForEnd(end: Date, firstEnd: Date, timeZone: string) {
  const endDate = localDateParts(end, timeZone)
  const firstDate = localDateParts(firstEnd, timeZone)
  const endDay = Date.UTC(endDate.year, endDate.month - 1, endDate.day)
  const firstDay = Date.UTC(firstDate.year, firstDate.month - 1, firstDate.day)
  return Math.floor((endDay - firstDay) / 86_400_000) + 1
}

function formatWindowLabel(startTime: number, endTime: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `${formatter.format(new Date(startTime * 1000))} - ${formatter.format(new Date(endTime * 1000))} ET`
}

function zonedDateTimeToUtc(parts: DateParts, timeZone: string) {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  let utc = localAsUtc - timeZoneOffset(new Date(localAsUtc), timeZone)
  utc = localAsUtc - timeZoneOffset(new Date(utc), timeZone)
  return new Date(utc)
}

function timeZoneOffset(date: Date, timeZone: string) {
  const parts = localDateParts(date, timeZone)
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return localAsUtc - date.getTime()
}

function localDateParts(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

function shiftLocalDate(parts: DateParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('en-US')
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function titleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
