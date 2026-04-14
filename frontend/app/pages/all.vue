<template>
  <div class="all-page">
    <AppHeader />

    <main class="all-content">
      <div class="all-toolbar">
        <button class="text-btn back-link" type="button" @click="$router.back()">[back]</button>
        <h1 class="all-heading">all vessel tokens</h1>
        <span class="all-meta">{{ totalRows.toLocaleString() }} matched</span>
        <span v-if="ownershipLoading" class="all-meta">loading ownership</span>
        <span v-else-if="detailsLoading" class="all-meta">{{ detailLoadLabel }}</span>
        <div class="pager">
          <button class="text-btn" type="button" :disabled="page <= 1" @click="page--">[prev]</button>
          <span>{{ pageStart.toLocaleString() }}-{{ pageEnd.toLocaleString() }} of {{ totalRows.toLocaleString() }}</span>
          <button class="text-btn" type="button" :disabled="pageEnd >= totalRows" @click="page++">[next]</button>
        </div>
      </div>

      <div v-if="statusMessage" class="status" :class="{ 'status-error': hasError }">
        <span>{{ statusMessage }}</span>
        <button class="text-btn" type="button" @click="reload">[retry]</button>
      </div>

      <section class="filters" aria-label="vessel filters">
        <label class="filter-field filter-search">
          <span>search</span>
          <input
            v-model.trim="search"
            class="filter-input"
            type="search"
            placeholder="token id or owner address"
          >
        </label>

        <label class="filter-field">
          <span>claimed</span>
          <select v-model="claimFilter" class="filter-input">
            <option value="all">all</option>
            <option value="claimed">claimed</option>
            <option value="unclaimed">unclaimed</option>
          </select>
        </label>

        <label class="filter-field">
          <span>filled</span>
          <select v-model="filledFilter" class="filter-input">
            <option value="all">all</option>
            <option value="filled">filled</option>
            <option value="empty">not filled</option>
          </select>
        </label>

        <label class="filter-field">
          <span>type</span>
          <select v-model="typeFilter" class="filter-input">
            <option value="all">all</option>
            <option value="capsule">capsule</option>
            <option value="vault">vault</option>
            <option value="machine">machine</option>
          </select>
        </label>

        <label class="filter-field">
          <span>color</span>
          <select v-model="colorFilter" class="filter-input">
            <option value="all">all</option>
            <option value="0">grayscale</option>
            <option value="1">red</option>
            <option value="2">green</option>
            <option value="3">blue</option>
          </select>
        </label>

        <button class="text-btn reset-btn" type="button" @click="resetFilters">[reset]</button>
      </section>
      <div class="table-wrap">
        <table class="vessel-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column.key">
                <button
                  class="sort-btn"
                  type="button"
                  :class="{ active: sortKey === column.key }"
                  :aria-sort="ariaSort(column.key)"
                  @click="toggleSort(column.key)"
                >
                  {{ column.label }}<span class="sort-indicator">{{ sortIndicator(column.key) }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="visibleRows.length === 0">
              <td :colspan="columns.length" class="empty-cell">{{ emptyMessage }}</td>
            </tr>
            <tr v-for="row in visibleRows" :key="row.id" :class="{ loading: row.loadingDetails }">
              <td class="mono-cell">
                <NuxtLink :to="`/${row.id}`" class="table-link">#{{ row.id }}</NuxtLink>
              </td>
              <td>{{ claimLabel(row) }}</td>
              <td>
                <NuxtLink v-if="row.owner" :to="`/address/${row.owner}`" class="table-link">
                  {{ shortenAddress(row.owner) }}
                </NuxtLink>
                <span v-else>-</span>
              </td>
              <td :class="typeClass(row.type)">{{ row.type ?? '-' }}</td>
              <td>{{ filledLabel(row) }}</td>
              <td class="number-cell">{{ formatNullable(row.payloadBytes) }}</td>
              <td class="number-cell">{{ row.capacityBytes.toLocaleString() }}</td>
              <td>{{ colorLabel(row) }}</td>
              <td class="number-cell">{{ formatNullable(row.role) }}</td>
              <td class="number-cell">{{ formatNullable(row.claimBlock) }}</td>
              <td class="number-cell">{{ formatNullable(row.entryCount) }}</td>
              <td class="number-cell">{{ formatNullable(row.chosenEntry) }}</td>
              <td>
                <NuxtLink v-if="row.delegate" :to="`/address/${row.delegate}`" class="table-link">
                  {{ shortenAddress(row.delegate) }}
                </NuxtLink>
                <span v-else>-</span>
              </td>
              <td>{{ row.machineAddress ? shortenAddress(row.machineAddress) : '-' }}</td>
              <td>{{ row.chosenMachine ? shortenAddress(row.chosenMachine) : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { readContracts } from '@wagmi/core'
import { useConfig } from '@wagmi/vue'
import { VESSEL_ADDRESS, VESSEL_ABI, colorModeName, hexToBytes, shortenAddress, type ColorMode } from '~/utils/vessel'
import { fetchOwnership } from '~/composables/useOwnership'

type SortKey =
  | 'id'
  | 'claimed'
  | 'owner'
  | 'type'
  | 'filled'
  | 'payloadBytes'
  | 'capacityBytes'
  | 'colorMode'
  | 'role'
  | 'claimBlock'
  | 'entryCount'
  | 'chosenEntry'
  | 'delegate'
  | 'machineAddress'
  | 'chosenMachine'

interface VesselRow {
  id: number
  claimed: boolean | null
  hydrated: boolean
  detailsLoaded: boolean
  loadingDetails: boolean
  owner: string | null
  type: string | null
  filled: boolean | null
  payloadBytes: number | null
  capacityBytes: number
  colorMode: ColorMode | null
  role: number | null
  claimBlock: number | null
  entryCount: number | null
  chosenEntry: number | null
  delegate: string | null
  machineAddress: string | null
  chosenMachine: string | null
}

const TOTAL_VESSELS = 10000
const PAGE_SIZE = 50
const VISIBLE_DETAIL_BATCH_SIZE = 8
const FULL_DETAIL_BATCH_SIZE = 8
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/
const DETAIL_CALLS = [
  'craftToClaimed',
  'craftToType',
  'craftToPayload',
  'craftToColorMode',
  'craftToRole',
  'craftToClaimBlock',
  'craftToEntry',
  'craftToChosenEntry',
  'craftToDelegate',
  'craftToMachine',
  'craftToChosenMachine',
] as const

const wagmiConfig = useConfig()
const allRows = ref<VesselRow[]>([])
const ownershipLoading = ref(false)
const detailsLoading = ref(false)
const fullDetailsLoading = ref(false)
const fullDetailsLoaded = ref(false)
const ownershipError = ref<string | null>(null)
const detailsError = ref<string | null>(null)

const search = ref('')
const claimFilter = ref<'all' | 'claimed' | 'unclaimed'>('all')
const filledFilter = ref<'all' | 'filled' | 'empty'>('all')
const typeFilter = ref<'all' | 'capsule' | 'vault' | 'machine'>('all')
const colorFilter = ref<'all' | '0' | '1' | '2' | '3'>('all')
const page = ref(1)
const sortKey = ref<SortKey>('claimed')
const sortDir = ref<'asc' | 'desc'>('desc')
let detailsToken = 0
let detailsTimer: ReturnType<typeof setTimeout> | null = null

const columns: { key: SortKey; label: string }[] = [
  { key: 'id', label: 'id' },
  { key: 'claimed', label: 'claimed' },
  { key: 'owner', label: 'owner' },
  { key: 'type', label: 'type' },
  { key: 'filled', label: 'filled' },
  { key: 'payloadBytes', label: 'bytes' },
  { key: 'capacityBytes', label: 'capacity' },
  { key: 'colorMode', label: 'color' },
  { key: 'role', label: 'role' },
  { key: 'claimBlock', label: 'claim block' },
  { key: 'entryCount', label: 'entries' },
  { key: 'chosenEntry', label: 'chosen entry' },
  { key: 'delegate', label: 'delegate' },
  { key: 'machineAddress', label: 'machine' },
  { key: 'chosenMachine', label: 'chosen machine' },
]

const detailSortKeys = new Set<SortKey>([
  'type',
  'filled',
  'payloadBytes',
  'colorMode',
  'role',
  'claimBlock',
  'entryCount',
  'chosenEntry',
  'delegate',
  'machineAddress',
  'chosenMachine',
])

const searchError = computed(() => {
  const q = search.value.trim()
  if (!q || /^\d+$/.test(q) || ADDRESS_PATTERN.test(q)) return null
  return 'search currently supports token ids and exact owner addresses'
})

const hasError = computed(() => Boolean(ownershipError.value || detailsError.value || searchError.value))
const statusMessage = computed(() => searchError.value || ownershipError.value || detailsError.value)
const queryNeedsFullDetails = computed(() => (
  filledFilter.value !== 'all'
  || typeFilter.value !== 'all'
  || colorFilter.value !== 'all'
  || detailSortKeys.has(sortKey.value)
))

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  let rows = allRows.value

  if (q) {
    if (/^\d+$/.test(q)) {
      const id = Number(q)
      rows = Number.isInteger(id) ? rows.filter(row => row.id === id) : []
    } else if (ADDRESS_PATTERN.test(q)) {
      rows = rows.filter(row => row.owner?.toLowerCase() === q)
    } else {
      rows = []
    }
  }

  rows = rows.filter((row) => {
    if (claimFilter.value === 'claimed' && row.claimed !== true) return false
    if (claimFilter.value === 'unclaimed' && row.claimed !== false) return false
    if (filledFilter.value === 'filled' && row.filled !== true) return false
    if (filledFilter.value === 'empty' && row.filled !== false) return false
    if (typeFilter.value !== 'all' && row.type !== typeFilter.value) return false
    if (colorFilter.value !== 'all' && row.colorMode !== Number(colorFilter.value)) return false
    return true
  })

  return [...rows].sort((a, b) => {
    const result = compareValues(sortValue(a, sortKey.value), sortValue(b, sortKey.value))
    return sortDir.value === 'asc' ? result : -result
  })
})

const totalRows = computed(() => filteredRows.value.length)
const detailsLoadedCount = computed(() => allRows.value.filter(row => row.detailsLoaded).length)
const detailLoadLabel = computed(() => (
  fullDetailsLoading.value
    ? `loading traits ${detailsLoadedCount.value.toLocaleString()}/${TOTAL_VESSELS.toLocaleString()}`
    : 'loading traits'
))
const visibleRows = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filteredRows.value.slice(start, start + PAGE_SIZE)
})
const visibleRowIds = computed(() => visibleRows.value.map(row => row.id).join(','))
const pageStart = computed(() => visibleRows.value.length === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1)
const pageEnd = computed(() => Math.min(totalRows.value, (page.value - 1) * PAGE_SIZE + visibleRows.value.length))
const emptyMessage = computed(() => {
  if (queryNeedsFullDetails.value && fullDetailsLoading.value) return 'loading matching vessels...'
  if (ownershipLoading.value || detailsLoading.value) return 'loading vessels...'
  if (searchError.value) return 'invalid search'
  return 'no vessels matched'
})

function createRow(id: number): VesselRow {
  return {
    id,
    claimed: null,
    hydrated: false,
    detailsLoaded: false,
    loadingDetails: false,
    owner: null,
    type: null,
    filled: null,
    payloadBytes: null,
    capacityBytes: id,
    colorMode: null,
    role: null,
    claimBlock: null,
    entryCount: null,
    chosenEntry: null,
    delegate: null,
    machineAddress: null,
    chosenMachine: null,
  }
}

function sortValue(row: VesselRow, key: SortKey): string | number | boolean | null {
  return row[key] as string | number | boolean | null
}

function compareValues(a: string | number | boolean | null, b: string | number | boolean | null) {
  const aMissing = a === null || a === undefined || a === ''
  const bMissing = b === null || b === undefined || b === ''
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b)
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b)
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

function resultAt(results: any[], rowIndex: number, callIndex: number) {
  const value = results[rowIndex * DETAIL_CALLS.length + callIndex]
  return value?.status === 'success' ? value.result : null
}

function numberValue(value: unknown): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function boolValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function addressValue(value: unknown): string | null {
  const address = String(value || ZERO_ADDRESS)
  return address.toLowerCase() === ZERO_ADDRESS ? null : address
}

function payloadByteLength(value: unknown): number | null {
  if (typeof value !== 'string') return null
  return hexToBytes(value).length
}

function applyDetailResults(batch: number[], results: any[]) {
  for (let rowIndex = 0; rowIndex < batch.length; rowIndex++) {
    const id = batch[rowIndex]!
    const row = allRows.value[id - 1]
    if (!row) continue

    const claimed = boolValue(resultAt(results, rowIndex, 0))
    const type = resultAt(results, rowIndex, 1)
    const payloadBytes = payloadByteLength(resultAt(results, rowIndex, 2))
    const colorMode = numberValue(resultAt(results, rowIndex, 3))
    const role = numberValue(resultAt(results, rowIndex, 4))
    const claimBlock = numberValue(resultAt(results, rowIndex, 5))
    const entryCount = numberValue(resultAt(results, rowIndex, 6))
    const chosenEntry = numberValue(resultAt(results, rowIndex, 7))
    const delegate = addressValue(resultAt(results, rowIndex, 8))
    const machineAddress = addressValue(resultAt(results, rowIndex, 9))
    const chosenMachine = addressValue(resultAt(results, rowIndex, 10))
    const loadedFieldCount = results
      .slice(rowIndex * DETAIL_CALLS.length, (rowIndex + 1) * DETAIL_CALLS.length)
      .filter(item => item?.status === 'success').length

    row.claimed = claimed ?? row.claimed
    row.type = typeof type === 'string' ? type.toLowerCase() : row.type
    row.payloadBytes = payloadBytes
    row.filled = payloadBytes == null ? null : payloadBytes > 0
    row.colorMode = colorMode == null ? row.colorMode : colorMode as ColorMode
    row.role = role
    row.claimBlock = claimBlock
    row.entryCount = entryCount
    row.chosenEntry = chosenEntry
    row.delegate = delegate
    row.machineAddress = machineAddress
    row.chosenMachine = chosenMachine
    row.hydrated = loadedFieldCount > 0
    row.detailsLoaded = true
    row.loadingDetails = false
  }
}

async function readDetailBatch(batch: number[]) {
  const contracts = batch.flatMap(id =>
    DETAIL_CALLS.map(functionName => ({
      address: VESSEL_ADDRESS,
      abi: VESSEL_ABI,
      functionName,
      args: [BigInt(id)],
    })),
  )

  return readContracts(wagmiConfig, {
    contracts: contracts as any,
    allowFailure: true,
  }) as Promise<any[]>
}

async function loadOwnership() {
  ownershipLoading.value = true
  ownershipError.value = null

  try {
    const { ownership } = await fetchOwnership()
    allRows.value = allRows.value.map((row) => {
      const owner = ownership.get(String(row.id)) || null
      return {
        ...row,
        claimed: Boolean(owner),
        owner,
      }
    })
  } catch (e: any) {
    ownershipError.value = e?.data?.message || e?.message || 'ownership transfer replay unavailable'
  } finally {
    ownershipLoading.value = false
  }
}

function scheduleDetailsLoad() {
  if (detailsTimer) clearTimeout(detailsTimer)
  detailsTimer = setTimeout(() => {
    if (queryNeedsFullDetails.value) {
      void loadAllDetails()
    } else {
      void loadVisibleDetails()
    }
  }, 80)
}

async function loadVisibleDetails() {
  if (fullDetailsLoading.value) return

  const token = ++detailsToken
  const ids = visibleRows.value
    .filter(row => !row.detailsLoaded && !row.loadingDetails)
    .map(row => row.id)

  if (ids.length === 0) return

  detailsLoading.value = true
  detailsError.value = null

  try {
    for (let i = 0; i < ids.length && token === detailsToken; i += VISIBLE_DETAIL_BATCH_SIZE) {
      const batch = ids.slice(i, i + VISIBLE_DETAIL_BATCH_SIZE)
      for (const id of batch) {
        const row = allRows.value[id - 1]
        if (row) row.loadingDetails = true
      }

      try {
        const results = await readDetailBatch(batch)

        if (token !== detailsToken) {
          for (const id of batch) {
            const row = allRows.value[id - 1]
            if (row) row.loadingDetails = false
          }
          return
        }

        applyDetailResults(batch, results)
      } catch (e: any) {
        if (token === detailsToken) {
          detailsError.value = e?.shortMessage || e?.message || 'trait reads unavailable'
        }
        for (const id of batch) {
          const row = allRows.value[id - 1]
          if (row) row.loadingDetails = false
        }
      }
    }
  } finally {
    if (token === detailsToken) detailsLoading.value = false
  }
}

async function loadAllDetails() {
  if (fullDetailsLoading.value || fullDetailsLoaded.value) return

  const token = ++detailsToken
  fullDetailsLoading.value = true
  detailsLoading.value = true
  detailsError.value = null

  try {
    const ids = allRows.value
      .filter(row => !row.detailsLoaded)
      .map(row => row.id)

    for (let i = 0; i < ids.length && token === detailsToken; i += FULL_DETAIL_BATCH_SIZE) {
      const batch = ids.slice(i, i + FULL_DETAIL_BATCH_SIZE)
      const pendingBatch = batch.filter((id) => {
        const row = allRows.value[id - 1]
        return row && !row.detailsLoaded
      })

      if (pendingBatch.length === 0) continue

      for (const id of pendingBatch) {
        const row = allRows.value[id - 1]
        if (row) row.loadingDetails = true
      }

      try {
        const results = await readDetailBatch(pendingBatch)

        if (token !== detailsToken) {
          for (const id of pendingBatch) {
            const row = allRows.value[id - 1]
            if (row) row.loadingDetails = false
          }
          return
        }

        applyDetailResults(pendingBatch, results)
      } catch (e: any) {
        if (token === detailsToken) {
          detailsError.value = e?.shortMessage || e?.message || 'trait reads unavailable'
        }
        for (const id of pendingBatch) {
          const row = allRows.value[id - 1]
          if (row) row.loadingDetails = false
        }
      }
    }
  } finally {
    if (token === detailsToken) {
      fullDetailsLoaded.value = allRows.value.length > 0 && allRows.value.every(row => row.detailsLoaded)
      fullDetailsLoading.value = false
      detailsLoading.value = false
    }
  }
}

function resetDetailState() {
  detailsToken++
  fullDetailsLoading.value = false
  fullDetailsLoaded.value = false
  detailsLoading.value = false
  for (const row of allRows.value) {
    row.loadingDetails = false
  }
}

async function reload() {
  ownershipError.value = null
  detailsError.value = null
  resetDetailState()
  allRows.value = Array.from({ length: TOTAL_VESSELS }, (_, index) => createRow(index + 1))
  await loadOwnership()
  scheduleDetailsLoad()
}

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortKey.value = key
  sortDir.value = 'asc'
}

function sortIndicator(key: SortKey) {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? '↑' : '↓'
}

function ariaSort(key: SortKey) {
  if (sortKey.value !== key) return 'none'
  return sortDir.value === 'asc' ? 'ascending' : 'descending'
}

function resetFilters() {
  search.value = ''
  claimFilter.value = 'all'
  filledFilter.value = 'all'
  typeFilter.value = 'all'
  colorFilter.value = 'all'
  page.value = 1
  sortKey.value = 'claimed'
  sortDir.value = 'desc'
}

function typeClass(type: string | null) {
  return type ? `color-${type}` : ''
}

function colorLabel(row: VesselRow) {
  return row.colorMode == null ? '-' : colorModeName(row.colorMode)
}

function filledLabel(row: VesselRow) {
  if (row.filled == null) return '-'
  return row.filled ? 'filled' : 'not filled'
}

function boolLabel(value: boolean | null) {
  if (value == null) return '-'
  return value ? 'yes' : 'no'
}

function claimLabel(row: VesselRow) {
  if (row.claimed == null) return '-'
  return row.claimed ? 'claimed' : 'unclaimed'
}

function formatNullable(value: number | null) {
  return value == null ? '-' : value.toLocaleString()
}

watch(
  [search, claimFilter, filledFilter, typeFilter, colorFilter, sortKey, sortDir],
  () => {
    if (page.value !== 1) page.value = 1
  },
)

watch(visibleRowIds, () => {
  scheduleDetailsLoad()
})

watch(queryNeedsFullDetails, (needsFullDetails) => {
  if (needsFullDetails) void loadAllDetails()
})

onMounted(() => {
  allRows.value = Array.from({ length: TOTAL_VESSELS }, (_, index) => createRow(index + 1))
  void loadOwnership()
  scheduleDetailsLoad()
})

onUnmounted(() => {
  if (detailsTimer) clearTimeout(detailsTimer)
  detailsToken++
})

useHead({ title: 'all vessel tokens' })
</script>

<style scoped>
.all-page {
  font-family: var(--font-mono);
  min-height: 100vh;
}

.all-content {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 3rem);
}

.all-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
}

.all-toolbar .text-btn {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.all-toolbar .back-link {
  margin-bottom: 0;
}

.pager {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}

.pager span {
  min-width: 9.5rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 2.5rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-subtle);
  color: var(--muted);
  font-size: 12px;
}

.status-error {
  color: var(--color);
}

.all-heading {
  color: var(--color);
  font-size: 13px;
  line-height: 1;
  margin: 0;
  font-weight: 700;
  white-space: nowrap;
}

.all-meta {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  width: 8rem;
  min-width: 8rem;
}

.filter-search {
  width: 20rem;
  min-width: 14rem;
}

.filter-input {
  width: 100%;
  height: 2rem;
  min-width: 0;
  border: 1px solid var(--border-color);
  background: var(--background);
  color: var(--color);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.2;
  padding: 0.35rem 0.5rem;
  border-radius: var(--button-border-radius);
}

.filter-input:focus {
  outline: 1px solid var(--color);
  outline-offset: 0;
}

select.filter-input {
  cursor: pointer;
}

.reset-btn {
  align-self: end;
  height: 2rem;
}

.table-wrap {
  overflow: auto;
  max-height: calc(100vh - 10rem);
  border-bottom: 1px solid var(--border-color);
}

.vessel-table {
  border-collapse: collapse;
  min-width: 112rem;
  width: 100%;
  font-size: 12px;
  line-height: 1.35;
}

.vessel-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-muted);
  border-bottom: 1px solid var(--border-color);
  text-align: left;
  white-space: nowrap;
}

.vessel-table td {
  border-bottom: 1px solid var(--border-color);
  padding: 0.48rem 0.6rem;
  white-space: nowrap;
  vertical-align: middle;
}

.vessel-table th:first-child,
.vessel-table td:first-child {
  position: sticky;
  left: 0;
  z-index: 2;
}

.vessel-table th:first-child {
  top: 0;
  z-index: 4;
  background: var(--bg-muted);
}

.vessel-table td:first-child {
  z-index: 3;
  background: var(--background);
  border-right: 1px solid var(--border-color);
}

.vessel-table tbody tr:nth-child(even) td {
  background: color-mix(in srgb, var(--bg-subtle) 58%, transparent);
}

.vessel-table tbody tr:nth-child(even) td:first-child {
  background: var(--bg-subtle);
}

.vessel-table tr:hover td {
  background: var(--bg-muted);
}

.vessel-table tr.loading {
  color: var(--muted);
}

.sort-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.2;
  min-height: 2.4rem;
  padding: 0.55rem 0.6rem;
  text-align: left;
  text-transform: uppercase;
}

.sort-btn.active,
.sort-btn:hover {
  color: var(--color);
}

.sort-indicator {
  min-width: 0.75rem;
  text-align: right;
}

.table-link {
  color: var(--accent);
  text-decoration: none;
  text-underline-offset: 0.18em;
}

.table-link:hover {
  text-decoration: underline;
}

.mono-cell,
.number-cell {
  font-variant-numeric: tabular-nums;
}

.number-cell {
  text-align: right;
}

.empty-cell {
  color: var(--muted);
  padding: 1.5rem !important;
  text-align: center;
}

.color-capsule {
  color: var(--color-capsule);
}

.color-vault {
  color: var(--color-vault);
}

.color-machine {
  color: var(--color-machine);
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

@media (max-width: 720px) {
  .all-toolbar {
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.75rem;
  }

  .pager {
    width: 100%;
    margin-left: 0;
  }

  .pager span {
    min-width: 0;
  }

  .filters {
    padding: 0.75rem;
    gap: 0.6rem;
  }

  .filter-field {
    width: calc(50% - 0.3rem);
    min-width: calc(50% - 0.3rem);
  }

  .filter-search {
    width: 100%;
    min-width: 100%;
  }

  .table-wrap {
    max-height: calc(100vh - 14rem);
  }
}
</style>
