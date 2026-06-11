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
  const data = await $fetch<{ rows: any[] }>('/api/sequences/balances', {
    query: {
      address,
      includeToken: 'true',
      limit: 250,
    },
  })

  return Array.isArray(data.rows)
    ? data.rows.map((row): SequenceBalance => ({
        address: String(row.address ?? address),
        tokenId: String(row.tokenId ?? ''),
        balance: String(row.balance ?? '0'),
        updatedAt: row.updatedAt == null ? null : String(row.updatedAt),
        blockNumber: row.blockNumber == null ? null : String(row.blockNumber),
        token: normalizeSequenceToken(row.token),
      }))
    : []
}
