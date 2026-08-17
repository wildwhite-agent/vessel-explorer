export type StartMode = 'latest' | 'backfill'

export interface Config {
  discordWebhookUrl: string
  discordProjectWebhookUrl: string
  indexerUrl: string
  vesselBaseUrl: string
  visualizerBaseUrl: string
  convexUrl: string
  convexUpcomingQuery: string
  ethRpcUrl: string
  pollIntervalMs: number
  startMode: StartMode
  stateFile: string
  excludedEventTypes: Set<string>
  sendLatestOnStart: boolean
  dailySummaryEnabled: boolean
  dailySummaryTimeZone: string
  dailySummaryHour: number
  dailySummaryMinute: number
  dailySummaryWindowHours: number
  vesselDeployedAt: Date
  dailySummarySendLatestOnStart: boolean
}

const DEFAULT_INDEXER_URL = 'https://indexer.vessel.worldcomputer.art'
const DEFAULT_VESSEL_BASE_URL = 'https://vessel.worldcomputer.art'
const DEFAULT_VISUALIZER_BASE_URL = 'https://visualizer.thevessel.fun'
const DEFAULT_CONVEX_URL = 'https://festive-hummingbird-510.convex.cloud'
const DEFAULT_CONVEX_UPCOMING_QUERY = 'upcoming:listAnnouncements'
const DEFAULT_ETH_RPC_URL = 'https://ethereum-rpc.publicnode.com'
const DEFAULT_POLL_INTERVAL_MS = 15_000
const DEFAULT_STATE_FILE = '/data/state.json'
const DEFAULT_EXCLUDED_EVENT_TYPES = 'transfer,metadata'
const DEFAULT_DAILY_SUMMARY_TIMEZONE = 'America/New_York'
const DEFAULT_DAILY_SUMMARY_HOUR = 15
const DEFAULT_DAILY_SUMMARY_MINUTE = 0
const DEFAULT_DAILY_SUMMARY_WINDOW_HOURS = 24
const DEFAULT_VESSEL_DEPLOYED_AT = '2026-02-24T04:59:35.000Z'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const discordWebhookUrl = stringEnv(env, 'DISCORD_WEBHOOK_URL')
  if (!discordWebhookUrl) {
    throw new Error('DISCORD_WEBHOOK_URL is required')
  }

  const startMode = (env.START_MODE || 'latest').toLowerCase()
  if (startMode !== 'latest' && startMode !== 'backfill') {
    throw new Error('START_MODE must be "latest" or "backfill"')
  }

  return {
    discordWebhookUrl,
    discordProjectWebhookUrl: stringEnv(env, 'DISCORD_PROJECT_WEBHOOK_URL'),
    indexerUrl: trimTrailingSlash(env.INDEXER_URL || DEFAULT_INDEXER_URL),
    vesselBaseUrl: trimTrailingSlash(env.VESSEL_BASE_URL || DEFAULT_VESSEL_BASE_URL),
    visualizerBaseUrl: trimTrailingSlash(env.VISUALIZER_BASE_URL || DEFAULT_VISUALIZER_BASE_URL),
    convexUrl: trimTrailingSlash(env.CONVEX_URL || DEFAULT_CONVEX_URL),
    convexUpcomingQuery: env.CONVEX_UPCOMING_QUERY?.trim() || DEFAULT_CONVEX_UPCOMING_QUERY,
    ethRpcUrl: env.ETH_RPC_URL || DEFAULT_ETH_RPC_URL,
    pollIntervalMs: positiveIntegerEnv(env, 'POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
    startMode,
    stateFile: env.STATE_FILE || DEFAULT_STATE_FILE,
    excludedEventTypes: commaSet(env.EXCLUDED_EVENT_TYPES || DEFAULT_EXCLUDED_EVENT_TYPES),
    sendLatestOnStart: booleanEnv(env, 'SEND_LATEST_ON_START', false),
    dailySummaryEnabled: booleanEnv(env, 'DAILY_SUMMARY_ENABLED', true),
    dailySummaryTimeZone: env.DAILY_SUMMARY_TIMEZONE || DEFAULT_DAILY_SUMMARY_TIMEZONE,
    dailySummaryHour: boundedIntegerEnv(env, 'DAILY_SUMMARY_HOUR', DEFAULT_DAILY_SUMMARY_HOUR, 0, 23),
    dailySummaryMinute: boundedIntegerEnv(env, 'DAILY_SUMMARY_MINUTE', DEFAULT_DAILY_SUMMARY_MINUTE, 0, 59),
    dailySummaryWindowHours: positiveIntegerEnv(env, 'DAILY_SUMMARY_WINDOW_HOURS', DEFAULT_DAILY_SUMMARY_WINDOW_HOURS),
    vesselDeployedAt: dateEnv(env, 'VESSEL_DEPLOYED_AT', DEFAULT_VESSEL_DEPLOYED_AT),
    dailySummarySendLatestOnStart: booleanEnv(env, 'DAILY_SUMMARY_SEND_LATEST_ON_START', false),
  }
}

function stringEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim()
  return value || ''
}

function positiveIntegerEnv(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const raw = env[key]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`)
  }
  return value
}

function boundedIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = env[key]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`)
  }
  return value
}

function commaSet(value: string) {
  return new Set(
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
}

function booleanEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean) {
  const value = env[key]?.trim().toLowerCase()
  if (!value) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function dateEnv(env: NodeJS.ProcessEnv, key: string, fallback: string) {
  const value = new Date(env[key] || fallback)
  if (Number.isNaN(value.getTime())) {
    throw new Error(`${key} must be a valid ISO date`)
  }
  return value
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function isUpcomingPollerEnabled(config: Config) {
  return Boolean(config.convexUrl && config.discordProjectWebhookUrl)
}
