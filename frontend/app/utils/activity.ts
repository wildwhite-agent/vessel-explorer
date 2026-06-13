export interface VesselTransaction {
  hash: string
  actor?: string | null
  from: string
  to: string
  timeStamp: string
  blockNumber: string
  input: string
  isError: string
  functionName: string
  action: string
  source: string
  subjectType: string | null
  subjectId: string | null
  amount: string | null
  vesselId: string | null
  craftType?: string | null
  sequence?: SequenceToken | null
  buyer?: string | null
  seller?: string | null
  salePrice?: {
    amountRaw: string | null
    decimals: number | null
    symbol: string
    token: string | null
    formatted: string
  }
  detail: string
}

export interface SequenceToken {
  tokenId: string
  artist: string
  artistAddress: string | null
  maxSupply: string
  price: string
  minted: string
  locked: boolean
  eventNumStart: string
  eventNumEnd: string
  uri: string
  usesRenderer: boolean
  renderer: string | null
  updatedAt: string | null
  blockNumber: string | null
}

export interface DailyActivityDay {
  date: string
  count: number
}

export interface DailyActivityResponse {
  startDate: string
  endDate: string
  total: number
  maxCount: number
  days: DailyActivityDay[]
  source: 'ponder'
}

interface ActivityFetchOptions {
  type?: string
  types?: readonly string[] | string
}

export async function fetchVesselActivity(
  page = 1,
  offset = 50,
  options: ActivityFetchOptions = {},
): Promise<VesselTransaction[]> {
  const query: Record<string, string | number> = { page, offset }
  let types: string | undefined
  if (typeof options.types === 'string') {
    types = options.types
  } else if (options.types) {
    types = [...options.types].filter(Boolean).join(',')
  }

  if (options.type) query.type = options.type
  if (types) query.types = types

  const txs = await $fetch<unknown[]>('/api/activity', {
    query,
  })
  if (!Array.isArray(txs)) return []

  return txs.map((tx: any) => ({
    hash: tx.hash,
    actor: tx.actor ?? null,
    from: tx.from,
    to: tx.to,
    timeStamp: tx.timeStamp,
    blockNumber: tx.blockNumber,
    input: tx.input ?? '0x',
    isError: tx.isError ?? '0',
    functionName: tx.functionName ?? '',
    action: tx.action ?? tx._action ?? 'unknown',
    source: tx.source ?? 'vessel',
    subjectType: tx.subjectType ?? null,
    subjectId: tx.subjectId == null ? null : String(tx.subjectId),
    amount: tx.amount == null ? null : String(tx.amount),
    vesselId: tx.vesselId ?? tx._vesselId ?? null,
    craftType: tx.craftType ?? tx._craftType ?? null,
    sequence: normalizeSequenceToken(tx.sequence),
    buyer: tx.buyer ?? null,
    seller: tx.seller ?? null,
    salePrice: normalizeSalePrice(tx.salePrice),
    detail: tx.detail ?? tx._detail ?? tx.action ?? 'unknown',
  }))
}

export function normalizeSequenceToken(value: any): SequenceToken | null {
  if (!value || typeof value !== 'object') return null
  return {
    tokenId: String(value.tokenId ?? ''),
    artist: String(value.artist ?? ''),
    artistAddress: value.artistAddress == null ? null : String(value.artistAddress),
    maxSupply: String(value.maxSupply ?? '0'),
    price: String(value.price ?? '0'),
    minted: String(value.minted ?? '0'),
    locked: Boolean(value.locked),
    eventNumStart: String(value.eventNumStart ?? '0'),
    eventNumEnd: String(value.eventNumEnd ?? '0'),
    uri: String(value.uri ?? ''),
    usesRenderer: Boolean(value.usesRenderer),
    renderer: value.renderer == null ? null : String(value.renderer),
    updatedAt: value.updatedAt == null ? null : String(value.updatedAt),
    blockNumber: value.blockNumber == null ? null : String(value.blockNumber),
  }
}

function normalizeSalePrice(value: any): VesselTransaction['salePrice'] {
  if (!value || typeof value !== 'object') return undefined
  return {
    amountRaw: value.amountRaw == null ? null : String(value.amountRaw),
    decimals: value.decimals == null ? null : Number(value.decimals),
    symbol: String(value.symbol || 'MIXED'),
    token: value.token == null ? null : String(value.token),
    formatted: String(value.formatted || 'mixed payment'),
  }
}

export async function fetchDailyActivity(): Promise<DailyActivityResponse> {
  const data = await $fetch<DailyActivityResponse>('/api/activity/daily')
  const days = Array.isArray(data.days)
    ? data.days.map((day) => ({
        date: String(day.date),
        count: Number(day.count || 0),
      }))
    : []

  return {
    startDate: String(data.startDate || days[0]?.date || ''),
    endDate: String(data.endDate || days.at(-1)?.date || ''),
    total: Number(data.total || 0),
    maxCount: Number(data.maxCount || Math.max(0, ...days.map((day) => day.count))),
    days,
    source: 'ponder',
  }
}

export interface TokenTransfer {
  hash: string
  from: string
  to: string
  tokenID: string
  blockNumber: string
  timeStamp: string
}

export async function fetchVesselTransfersForAddress(address: string): Promise<TokenTransfer[]> {
  const data = await $fetch<unknown[]>('/api/transfers', {
    query: { address },
  })
  return Array.isArray(data) ? data as TokenTransfer[] : []
}
