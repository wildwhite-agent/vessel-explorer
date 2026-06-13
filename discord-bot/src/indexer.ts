import type { ActivityCursor, ProtocolStats, VesselActivity } from './types.js'

export interface FetchActivityOptions {
  limit?: number
  page?: number
  startTime?: number
  endTime?: number
}

export async function fetchActivity(
  indexerUrl: string,
  options: FetchActivityOptions | number = {},
): Promise<VesselActivity[]> {
  const resolved = typeof options === 'number' ? { limit: options } : options
  const url = new URL('/activity', indexerUrl)
  url.searchParams.set('limit', String(resolved.limit ?? 100))
  if (resolved.page !== undefined) url.searchParams.set('page', String(resolved.page))
  if (resolved.startTime !== undefined) url.searchParams.set('startTime', String(resolved.startTime))
  if (resolved.endTime !== undefined) url.searchParams.set('endTime', String(resolved.endTime))

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`indexer request failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  if (!Array.isArray(data)) return []
  return data.map(normalizeActivity).filter(Boolean) as VesselActivity[]
}

export async function fetchAllActivity(
  indexerUrl: string,
  options: Omit<FetchActivityOptions, 'page'>,
) {
  const limit = options.limit ?? 1000
  const rows: VesselActivity[] = []
  for (let page = 1; ; page++) {
    const pageRows = await fetchActivity(indexerUrl, { ...options, limit, page })
    rows.push(...pageRows)
    if (pageRows.length < limit) return rows
  }
}

export async function fetchStats(indexerUrl: string): Promise<ProtocolStats> {
  const url = new URL('/stats', indexerUrl)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`indexer stats request failed: ${response.status} ${response.statusText}`)
  }

  return normalizeStats(await response.json())
}

export function isIncludedActivity(
  activity: VesselActivity,
  excludedEventTypes: Set<string>,
) {
  const action = activity.action.toLowerCase()
  if (excludedEventTypes.has(action)) return false
  if (activity.functionName.toLowerCase().startsWith('refreshmetadata')) return false
  if (action === 'sequencemint') return Boolean(activity.subjectId)
  if (action === 'vwuclaim') return Boolean(activity.vesselId)
  if (!activity.vesselId) return false
  return true
}

export function cursorForActivity(activity: VesselActivity): ActivityCursor {
  const subjectKey = activity.vesselId ?? activity.subjectId
  if (!subjectKey) {
    throw new Error('cannot create cursor for activity without vesselId or subjectId')
  }
  return {
    ...(activity.id ? { id: activity.id } : {}),
    ...(activity.logIndex != null ? { logIndex: activity.logIndex } : {}),
    blockNumber: activity.blockNumber,
    hash: activity.hash,
    action: activity.action,
    vesselId: subjectKey,
  }
}

export function cursorKey(cursor: ActivityCursor) {
  if (cursor.id) return `id:${cursor.id}`
  if (cursor.logIndex != null) {
    return [
      'log',
      cursor.blockNumber,
      cursor.hash.toLowerCase(),
      cursor.logIndex,
    ].join(':')
  }
  return [
    'legacy',
    cursor.blockNumber,
    cursor.hash.toLowerCase(),
    cursor.action.toLowerCase(),
    cursor.vesselId,
  ].join(':')
}

export function activityKey(activity: VesselActivity) {
  if (activity.id) return `id:${activity.id}`
  if (activity.logIndex != null) {
    return [
      'log',
      activity.blockNumber,
      activity.hash.toLowerCase(),
      activity.logIndex,
    ].join(':')
  }
  return legacyActivityKey(activity)
}

export function relatedActivityKey(activity: NonNullable<VesselActivity['relatedEvents']>[number]) {
  if (activity.id) return `id:${activity.id}`
  if (activity.logIndex != null) {
    return [
      'log',
      activity.blockNumber,
      activity.hash.toLowerCase(),
      activity.logIndex,
    ].join(':')
  }
  return ''
}

export function activityRememberKeys(activity: VesselActivity) {
  return [
    activityKey(activity),
    ...(activity.relatedEvents ?? []).map(relatedActivityKey),
  ].filter(Boolean)
}

export function activityMatchesCursor(activity: VesselActivity, cursor: ActivityCursor) {
  const key = cursorKey(cursor)
  return activityKey(activity) === key || legacyActivityKey(activity) === key
}

function legacyActivityKey(activity: VesselActivity) {
  return [
    'legacy',
    activity.blockNumber,
    activity.hash.toLowerCase(),
    activity.action.toLowerCase(),
    activity.vesselId ?? activity.subjectId ?? '',
  ].join(':')
}

export function newActivitiesSinceCursor(
  activitiesNewestFirst: VesselActivity[],
  cursor: ActivityCursor | null,
) {
  if (!cursor) return [...activitiesNewestFirst].reverse()

  const key = cursorKey(cursor)
  const newer: VesselActivity[] = []
  for (const activity of activitiesNewestFirst) {
    if (activityMatchesCursor(activity, cursor)) break
    newer.push(activity)
  }
  return newer.reverse()
}

function normalizeActivity(value: unknown): VesselActivity | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const hash = stringField(row.hash)
  const action = stringField(row.action ?? row._action)
  const blockNumber = stringField(row.blockNumber)
  if (!hash || !action || !blockNumber) return null

  return {
    id: nullableString(row.id),
    logIndex: numberField(row.logIndex),
    hash,
    actor: nullableString(row.actor),
    from: stringField(row.from),
    to: stringField(row.to),
    timeStamp: stringField(row.timeStamp),
    blockNumber,
    input: stringField(row.input) || '0x',
    isError: stringField(row.isError) || '0',
    functionName: stringField(row.functionName),
    action,
    source: stringField(row.source) || 'vessel',
    subjectType: nullableString(row.subjectType),
    subjectId: nullableString(row.subjectId),
    amount: nullableString(row.amount),
    vesselId: nullableString(row.vesselId ?? row._vesselId),
    craftType: nullableString(row.craftType ?? row._craftType),
    entry: numberField(row.entry),
    machineAddress: nullableString(row.machineAddress),
    automatic: Boolean(row.automatic),
    consolidatedInto: normalizeConsolidatedInto(row.consolidatedInto),
    relatedEvents: normalizeRelatedEvents(row.relatedEvents),
    sequence: normalizeSequence(row.sequence),
    buyer: nullableString(row.buyer),
    seller: nullableString(row.seller),
    salePrice: normalizeSalePrice(row.salePrice),
    detail: stringField(row.detail ?? row._detail),
  }
}

function normalizeConsolidatedInto(value: unknown): VesselActivity['consolidatedInto'] {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return {
    id: nullableString(row.id),
    type: stringField(row.type) || 'claim',
    logIndex: numberField(row.logIndex),
  }
}

function normalizeRelatedEvents(value: unknown): VesselActivity['relatedEvents'] {
  if (!Array.isArray(value)) return []
  return value
    .filter((event) => event && typeof event === 'object')
    .map((event) => {
      const row = event as Record<string, unknown>
      return {
        id: stringField(row.id),
        action: stringField(row.action),
        source: stringField(row.source) || 'vessel',
        sourceEvent: stringField(row.sourceEvent),
        actor: nullableString(row.actor),
        machineAddress: nullableString(row.machineAddress),
        hash: stringField(row.hash),
        blockNumber: stringField(row.blockNumber),
        logIndex: numberField(row.logIndex),
        timeStamp: stringField(row.timeStamp),
      }
    })
}

function normalizeSequence(value: unknown): VesselActivity['sequence'] {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return {
    tokenId: stringField(row.tokenId),
    artist: stringField(row.artist),
    artistAddress: nullableString(row.artistAddress),
    maxSupply: stringField(row.maxSupply),
    price: stringField(row.price),
    minted: stringField(row.minted),
    locked: Boolean(row.locked),
    eventNumStart: stringField(row.eventNumStart),
    eventNumEnd: stringField(row.eventNumEnd),
    uri: stringField(row.uri),
    usesRenderer: Boolean(row.usesRenderer),
    renderer: nullableString(row.renderer),
    updatedAt: nullableString(row.updatedAt),
    blockNumber: nullableString(row.blockNumber),
  }
}

function normalizeSalePrice(value: unknown): VesselActivity['salePrice'] {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  return {
    amountRaw: nullableString(row.amountRaw),
    decimals: numberField(row.decimals),
    symbol: stringField(row.symbol) || 'MIXED',
    token: nullableString(row.token),
    formatted: stringField(row.formatted) || 'mixed payment',
  }
}

function normalizeStats(value: unknown): ProtocolStats {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const tokens = row.tokens && typeof row.tokens === 'object'
    ? row.tokens as Record<string, unknown>
    : {}

  return {
    tokens: {
      total: numberField(tokens.total) ?? 0,
      claimed: numberField(tokens.claimed) ?? 0,
      filled: numberField(tokens.filled) ?? 0,
      claimedCapacityBytes: numberField(tokens.claimedCapacityBytes) ?? 0,
      filledBytes: numberField(tokens.filledBytes) ?? 0,
      uniqueHolders: numberField(tokens.uniqueHolders) ?? 0,
    },
  }
}

function stringField(value: unknown) {
  return value == null ? '' : String(value)
}

function nullableString(value: unknown) {
  const text = stringField(value)
  return text || null
}

function numberField(value: unknown) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
