import { hexToBytes, type ColorMode } from './vessel'
import { normalizeSequenceToken, type SequenceToken } from './activity'

export interface TokenRow {
  id: number
  claimed: boolean
  owner: string | null
  type: string | null
  filled: boolean
  payloadBytes: number
  capacityBytes: number
  colorMode: ColorMode | null
  role: number | null
  roleLabel: string | null
  axiom: boolean
  relic: boolean
  relicKind: string | null
  machineName: string | null
  claimBlock: number | null
  entryCount: number
  chosenEntry: number
  delegate: string | null
  machineAddress: string | null
  chosenMachine: string | null
  payloadHex?: string
  locked?: boolean
  lockBlock?: string | null
  isVault?: boolean
  isMachine?: boolean
}

export interface TokenPage {
  rows: TokenRow[]
  total: number
  page: number
  pageSize: number
  source: 'ponder'
}

export interface TokenEntry {
  entryIndex: number
  payloadHex: string
  payloadBytes: number
  txHash: string | null
  blockNumber: string
  logIndex: number | null
  timestamp: string
}

export interface HolderRow {
  address: string
  count: number
  machines: number
  vaults: number
  capsules: number
  empty: number
}

export interface GridSnapshotRow {
  id: number
  type: string | null
  payloadHex: string
  payloadBytes: number
  colorMode: ColorMode | null
}

export interface GridSnapshot {
  rows: GridSnapshotRow[]
  total: number
  source: 'ponder'
}

export interface SequenceBalance {
  address: string
  tokenId: string
  balance: string
  updatedAt: string | null
  blockNumber: string | null
  token: SequenceToken | null
}

export interface SequenceBalancePage {
  rows: SequenceBalance[]
  total: number
  page: number
  pageSize: number
  source: 'ponder'
}

export interface SequenceTokenPage {
  rows: SequenceToken[]
  total: number
  page: number
  pageSize: number
  source: 'ponder'
}

export interface SequenceTransfer {
  hash: string
  logIndex: number
  batchIndex: number
  operator: string
  from: string
  to: string
  tokenId: string
  value: string
  blockNumber: string
  timeStamp: string
}

export type SequenceMediaKind = 'html' | 'video' | 'audio' | 'svg' | 'image' | 'unknown'

export interface SequenceMediaAsset {
  url: string
  mime: string
  kind: SequenceMediaKind
  bytes: number | null
}

export interface SequenceTrait {
  traitType: string
  value: string
  displayType: string
}

export interface SequenceMedia {
  tokenId: string
  name: string
  description: string
  externalUrl: string
  attributes: SequenceTrait[]
  image: SequenceMediaAsset | null
  animation: SequenceMediaAsset | null
  preferred: SequenceMediaAsset | null
}

type QueryValue = string | number | boolean | null | undefined

export function bytesFromHex(hex: string | null | undefined) {
  return hexToBytes(hex || '0x')
}

export async function fetchTokenPage(params: Record<string, QueryValue> = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') query.set(key, String(value))
  }

  return await $fetch<TokenPage>(`/api/tokens?${query.toString()}`)
}

export async function fetchAllTokenRows(params: Record<string, QueryValue> = {}) {
  const pageSize = Math.min(250, Math.max(1, Number(params.pageSize) || 250))
  const rows: TokenRow[] = []

  for (let page = 1; page <= 100; page++) {
    const data = await fetchTokenPage({ ...params, page, pageSize })
    rows.push(...(Array.isArray(data.rows) ? data.rows : []))
    if (rows.length >= Number(data.total || 0) || data.rows.length < pageSize) break
  }

  return rows
}

export async function fetchTokensByIds(ids: number[], includePayload = false) {
  const uniqueIds = [...new Set(ids)]
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= 10_000)
    .slice(0, 250)
  if (!uniqueIds.length) return []

  const data = await fetchTokenPage({
    ids: uniqueIds.join(','),
    pageSize: uniqueIds.length,
    includePayload,
    sort: 'id',
    dir: 'asc',
  })
  return data.rows
}

export async function fetchToken(id: number) {
  return await $fetch<TokenRow>(`/api/tokens/${id}`)
}

export async function fetchTokenEntries(id: number) {
  const data = await $fetch<{ rows: TokenEntry[] }>(`/api/tokens/${id}/entries`)
  return Array.isArray(data.rows) ? data.rows : []
}

export async function fetchHolders(limit = 500) {
  const data = await $fetch<{ rows: HolderRow[] }>('/api/holders', {
    query: { limit },
  })
  return Array.isArray(data.rows) ? data.rows : []
}

export async function fetchGridSnapshot() {
  const data = await $fetch<GridSnapshot>('/api/grid')
  return {
    rows: Array.isArray(data.rows)
      ? data.rows.map((row) => ({
          id: Number(row.id),
          type: row.type || null,
          payloadHex: String(row.payloadHex || '0x'),
          payloadBytes: Number(row.payloadBytes || 0),
          colorMode: row.colorMode == null ? null : Number(row.colorMode) as ColorMode,
        }))
      : [],
    total: Number(data.total || 0),
    source: 'ponder' as const,
  }
}

export async function fetchSequenceBalancesForAddress(address: string) {
  const data = await fetchSequenceBalancePage({
    address,
    includeToken: 'true',
    limit: 250,
  }, address)

  return data.rows
}

export async function fetchSequenceBalancePage(
  params: Record<string, QueryValue> = {},
  fallbackAddress = '',
) {
  const data = await $fetch<{ rows: any[]; total: number; page: number; pageSize: number; source: 'ponder' }>('/api/sequences/balances', {
    query: {
      ...params,
    },
  })

  return {
    rows: Array.isArray(data.rows)
      ? data.rows.map((row): SequenceBalance => ({
        address: String(row.address ?? fallbackAddress),
        tokenId: String(row.tokenId ?? ''),
        balance: String(row.balance ?? '0'),
        updatedAt: row.updatedAt == null ? null : String(row.updatedAt),
        blockNumber: row.blockNumber == null ? null : String(row.blockNumber),
        token: normalizeSequenceToken(row.token),
      }))
      : [],
    total: Number(data.total || 0),
    page: Number(data.page || 1),
    pageSize: Number(data.pageSize || 0),
    source: 'ponder' as const,
  }
}

export async function fetchSequenceTokenPage(params: Record<string, QueryValue> = {}) {
  const data = await $fetch<{ rows: any[]; total: number; page: number; pageSize: number; source: 'ponder' }>('/api/sequences/tokens', {
    query: params,
  })

  return {
    rows: Array.isArray(data.rows)
      ? data.rows.map(normalizeSequenceToken).filter(Boolean) as SequenceToken[]
      : [],
    total: Number(data.total || 0),
    page: Number(data.page || 1),
    pageSize: Number(data.pageSize || 0),
    source: 'ponder' as const,
  }
}

export async function fetchAllSequenceTokens(params: Record<string, QueryValue> = {}) {
  const pageSize = Math.min(250, Math.max(1, Number(params.pageSize) || 250))
  const rows: SequenceToken[] = []

  for (let page = 1; page <= 100; page++) {
    const data = await fetchSequenceTokenPage({ ...params, page, pageSize })
    rows.push(...data.rows)
    if (rows.length >= Number(data.total || 0) || data.rows.length < pageSize) break
  }

  return rows
}

export async function fetchSequenceToken(id: string | number) {
  const data = await $fetch<unknown>(`/api/sequences/tokens/${id}`)
  return normalizeSequenceToken(data)
}

export async function fetchSequenceMedia(id: string | number) {
  const data = await $fetch<any>(`/api/sequences/tokens/${id}/media`)
  return {
    tokenId: String(data?.tokenId ?? id),
    name: String(data?.name ?? ''),
    description: String(data?.description ?? ''),
    externalUrl: String(data?.externalUrl ?? ''),
    attributes: normalizeSequenceTraits(data?.attributes),
    image: normalizeSequenceMediaAsset(data?.image),
    animation: normalizeSequenceMediaAsset(data?.animation),
    preferred: normalizeSequenceMediaAsset(data?.preferred),
  } satisfies SequenceMedia
}

function normalizeSequenceTraits(value: any): SequenceTrait[] {
  if (!Array.isArray(value)) return []
  const traits: SequenceTrait[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const traitType = String(entry.traitType ?? entry.trait_type ?? '')
    const traitValue = entry.value == null ? '' : String(entry.value)
    const displayType = String(entry.displayType ?? entry.display_type ?? '')
    if (!traitType && !traitValue) continue
    traits.push({ traitType, value: traitValue, displayType })
  }
  return traits
}

export async function fetchSequenceBalancesForToken(tokenId: string | number, limit = 250) {
  const data = await fetchSequenceBalancePage({
    tokenId,
    includeToken: 'true',
    limit,
  })

  return data.rows
}

export async function fetchSequenceTransfersForToken(tokenId: string | number, limit = 100) {
  const data = await $fetch<unknown[]>('/api/sequences/transfers', {
    query: {
      tokenId,
      limit,
    },
  })

  return Array.isArray(data)
    ? data.map((row: any): SequenceTransfer => ({
        hash: String(row.hash ?? ''),
        logIndex: Number(row.logIndex ?? 0),
        batchIndex: Number(row.batchIndex ?? 0),
        operator: String(row.operator ?? ''),
        from: String(row.from ?? ''),
        to: String(row.to ?? ''),
        tokenId: String(row.tokenId ?? tokenId),
        value: String(row.value ?? '0'),
        blockNumber: String(row.blockNumber ?? ''),
        timeStamp: String(row.timeStamp ?? ''),
      }))
    : []
}

function normalizeSequenceMediaAsset(value: any): SequenceMediaAsset | null {
  if (!value || typeof value !== 'object') return null
  return {
    url: String(value.url ?? ''),
    mime: String(value.mime ?? 'application/octet-stream'),
    kind: normalizeSequenceMediaKind(value.kind),
    bytes: value.bytes == null ? null : Number(value.bytes),
  }
}

function normalizeSequenceMediaKind(value: unknown): SequenceMediaKind {
  if (
    value === 'html'
    || value === 'video'
    || value === 'audio'
    || value === 'svg'
    || value === 'image'
    || value === 'unknown'
  ) {
    return value
  }
  return 'unknown'
}
