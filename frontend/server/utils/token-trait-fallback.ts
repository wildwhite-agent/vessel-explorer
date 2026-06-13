type TokenTraitName = 'axiom' | 'relic'

type TokenTrait = {
  roleLabel: string | null
  axiom: boolean
  relic: boolean
  relicKind: string | null
  machineName: string | null
}

type TokenPageResponse = {
  rows?: unknown[]
  total?: number
  page?: number
  pageSize?: number
  source?: string
  [key: string]: unknown
}

type TokenRow = Record<string, unknown>

const FALLBACK_PAGE_SIZE = 250
const MAX_FALLBACK_PAGES = 100
const TRAIT_FILTERS = new Set<TokenTraitName>(['axiom', 'relic'])
const ROLE_LABELS: Record<number, string> = {
  0: 'Undefined',
  1: 'Navigator',
  2: 'Steward',
  3: 'Merchant',
}

let tokenTraitsPromise: Promise<Map<number, TokenTrait>> | null = null

export async function applyTokenTraitFallback(
  data: TokenPageResponse,
  query: Record<string, unknown>,
  originalParams: URLSearchParams,
): Promise<TokenPageResponse> {
  const rows = normalizedRows(data.rows)
  const trait = traitFilterValue(query.trait)
  const supportsTraits = tokenRowsSupportTraits(rows)

  if (!trait) {
    if (supportsTraits) return data
    return {
      ...data,
      rows: await enrichTokenRows(rows),
    }
  }

  if (supportsTraits) return data

  return await fallbackTraitPage(data, query, originalParams, trait)
}

export async function applyTokenDetailTraitFallback(data: unknown) {
  if (!isTokenRow(data) || tokenRowsSupportTraits([data])) return data
  const [row] = await enrichTokenRows([data])
  return row ?? data
}

async function fallbackTraitPage(
  data: TokenPageResponse,
  query: Record<string, unknown>,
  originalParams: URLSearchParams,
  trait: TokenTraitName,
) {
  const page = positiveInteger(query.page, 1)
  const pageSize = positiveInteger(query.pageSize, 50)
  const claim = stringValue(query.claim).toLowerCase()

  if (claim === 'unclaimed') {
    return {
      ...data,
      rows: [],
      total: 0,
      page,
      pageSize,
    }
  }

  const candidateParams = new URLSearchParams(originalParams)
  candidateParams.delete('trait')
  candidateParams.set('claim', 'claimed')
  candidateParams.set('pageSize', String(FALLBACK_PAGE_SIZE))

  const candidateRows: TokenRow[] = []
  let candidateTotal = 0

  for (let nextPage = 1; nextPage <= MAX_FALLBACK_PAGES; nextPage++) {
    candidateParams.set('page', String(nextPage))
    const candidateData = await fetchIndexerJson('/tokens', candidateParams) as TokenPageResponse
    const pageRows = normalizedRows(candidateData.rows)

    candidateRows.push(...pageRows)
    candidateTotal = Number(candidateData.total || candidateRows.length)

    if (candidateRows.length >= candidateTotal || pageRows.length < FALLBACK_PAGE_SIZE) break
  }

  const filteredRows = (await enrichTokenRows(candidateRows))
    .filter((row) => row[trait] === true)

  const start = (page - 1) * pageSize
  return {
    ...data,
    rows: filteredRows.slice(start, start + pageSize),
    total: filteredRows.length,
    page,
    pageSize,
  }
}

async function enrichTokenRows(rows: TokenRow[]) {
  const traits = await loadTokenTraits()
  return rows.map((row) => {
    const id = Number(row.id)
    const trait = Number.isFinite(id) ? traits.get(id) : null
    return {
      ...row,
      roleLabel: row.roleLabel ?? trait?.roleLabel ?? roleLabelForRole(row.role),
      axiom: row.axiom ?? trait?.axiom ?? false,
      relic: row.relic ?? trait?.relic ?? false,
      relicKind: row.relicKind ?? trait?.relicKind ?? null,
      machineName: row.machineName ?? trait?.machineName ?? null,
    }
  })
}

async function loadTokenTraits() {
  if (!tokenTraitsPromise) {
    tokenTraitsPromise = readTokenTraits()
  }
  return await tokenTraitsPromise
}

async function readTokenTraits() {
  const raw = await useStorage('assets:server').getItemRaw('vessel-token-traits.json')
  if (!raw) return new Map<number, TokenTrait>()

  const text = typeof raw === 'string'
    ? raw
    : new TextDecoder().decode(raw as Uint8Array)
  const parsed = JSON.parse(text) as Record<string, TokenTrait>
  const traits = new Map<number, TokenTrait>()

  for (const [id, value] of Object.entries(parsed)) {
    const tokenId = Number(id)
    if (!Number.isInteger(tokenId)) continue
    traits.set(tokenId, {
      roleLabel: stringOrNull(value.roleLabel),
      axiom: value.axiom === true,
      relic: value.relic === true,
      relicKind: stringOrNull(value.relicKind),
      machineName: stringOrNull(value.machineName),
    })
  }

  return traits
}

function normalizedRows(rows: unknown) {
  return Array.isArray(rows)
    ? rows.filter(isTokenRow)
    : []
}

function isTokenRow(row: unknown): row is TokenRow {
  return Boolean(row) && typeof row === 'object' && !Array.isArray(row)
}

function tokenRowsSupportTraits(rows: TokenRow[]) {
  return rows.some((row) => (
    row.roleLabel != null
    || row.axiom != null
    || row.relic != null
    || row.relicKind != null
    || row.machineName != null
  ))
}

function traitFilterValue(value: unknown): TokenTraitName | null {
  const trait = stringValue(value).toLowerCase()
  return TRAIT_FILTERS.has(trait as TokenTraitName) ? trait as TokenTraitName : null
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function stringValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function stringOrNull(value: unknown) {
  const text = String(value || '').trim()
  return text ? text : null
}

function roleLabelForRole(role: unknown) {
  const parsed = Number(role)
  return Number.isInteger(parsed) ? ROLE_LABELS[parsed] ?? null : null
}
