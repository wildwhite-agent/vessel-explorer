<template>
  <div class="all-page">
    <AppHeader />

    <main class="all-content">
      <div class="all-toolbar">
        <button class="text-btn back-link" type="button" @click="$router.back()">[back]</button>
        <h1 class="all-heading">all vessel tokens</h1>
        <span class="all-meta">{{ totalRows.toLocaleString() }} matched</span>
        <span v-if="ensLoading" class="all-meta">resolving ens</span>
        <span v-else-if="databaseLoading" class="all-meta">loading database</span>
        <span v-else-if="ownershipLoading" class="all-meta">loading ownership</span>
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
            placeholder="token id, owner address, or ens"
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
          <span>trait</span>
          <select v-model="traitFilter" class="filter-input">
            <option value="all">all</option>
            <option value="axiom">axiom</option>
            <option value="relic">relic</option>
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
                <AddressDisplay v-if="row.owner" :address="row.owner" />
                <span v-else>-</span>
              </td>
              <td :class="typeClass(row.type)">{{ row.type ?? '-' }}</td>
              <td>
                <span v-if="traitLabels(row).length" class="trait-list">
                  <span v-for="trait in traitLabels(row)" :key="trait" class="trait-label">[{{ trait }}]</span>
                </span>
                <span v-else>-</span>
              </td>
              <td>{{ filledLabel(row) }}</td>
              <td class="number-cell">{{ formatNullable(row.payloadBytes) }}</td>
              <td class="number-cell">{{ row.capacityBytes.toLocaleString() }}</td>
              <td>{{ colorLabel(row) }}</td>
              <td>{{ roleLabel(row) }}</td>
              <td class="number-cell">{{ formatNullable(row.claimBlock) }}</td>
              <td class="number-cell">{{ formatNullable(row.entryCount) }}</td>
              <td class="number-cell">{{ formatNullable(row.chosenEntry) }}</td>
              <td>
                <AddressDisplay v-if="row.delegate" :address="row.delegate" />
                <span v-else>-</span>
              </td>
              <td>
                <template v-if="row.machineAddress">
                  <span v-if="row.machineName" class="machine-name">{{ row.machineName }}</span>
                  <AddressDisplay :address="row.machineAddress" external />
                </template>
                <span v-else>-</span>
              </td>
              <td>
                <AddressDisplay v-if="row.chosenMachine" :address="row.chosenMachine" external />
                <span v-else>-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { colorModeName, type ColorMode } from '~/utils/vessel'
import { fetchTokenPage, type TokenRow } from '~/utils/indexer'
import { resolveEnsName } from '~/utils/ens'
import { parseVesselSearchQuery } from '~/utils/search'

type SortKey =
  | 'id'
  | 'claimed'
  | 'owner'
  | 'type'
  | 'filled'
  | 'payloadBytes'
  | 'capacityBytes'
  | 'colorMode'
  | 'roleLabel'
  | 'axiom'
  | 'relic'
  | 'claimBlock'
  | 'entryCount'
  | 'chosenEntry'
  | 'delegate'
  | 'machineAddress'
  | 'chosenMachine'

interface VesselRow extends Omit<TokenRow, 'claimed' | 'filled' | 'payloadBytes' | 'capacityBytes' | 'entryCount' | 'chosenEntry'> {
  claimed: boolean | null
  filled: boolean | null
  payloadBytes: number | null
  capacityBytes: number
  entryCount: number | null
  chosenEntry: number | null
  loadingDetails: boolean
}

const PAGE_SIZE = 50

const databaseRows = ref<VesselRow[]>([])
const databaseTotalRows = ref(0)
const databaseLoading = ref(false)
const ensLoading = ref(false)
const ownershipLoading = ref(false)
const detailsLoading = ref(false)
const databaseError = ref<string | null>(null)

const search = ref('')
const claimFilter = ref<'all' | 'claimed' | 'unclaimed'>('all')
const filledFilter = ref<'all' | 'filled' | 'empty'>('all')
const typeFilter = ref<'all' | 'capsule' | 'vault' | 'machine'>('all')
const traitFilter = ref<'all' | 'axiom' | 'relic'>('all')
const colorFilter = ref<'all' | '0' | '1' | '2' | '3'>('all')
const page = ref(1)
const sortKey = ref<SortKey>('claimed')
const sortDir = ref<'asc' | 'desc'>('desc')
let databaseToken = 0

const columns: { key: SortKey; label: string }[] = [
  { key: 'id', label: 'id' },
  { key: 'claimed', label: 'claimed' },
  { key: 'owner', label: 'owner' },
  { key: 'type', label: 'type' },
  { key: 'axiom', label: 'traits' },
  { key: 'filled', label: 'filled' },
  { key: 'payloadBytes', label: 'bytes' },
  { key: 'capacityBytes', label: 'capacity' },
  { key: 'colorMode', label: 'color' },
  { key: 'roleLabel', label: 'role' },
  { key: 'claimBlock', label: 'claim block' },
  { key: 'entryCount', label: 'entries' },
  { key: 'chosenEntry', label: 'chosen entry' },
  { key: 'delegate', label: 'delegate' },
  { key: 'machineAddress', label: 'machine' },
  { key: 'chosenMachine', label: 'chosen machine' },
]

const searchError = computed(() => {
  const parsed = parseVesselSearchQuery(search.value)
  if (parsed.kind !== 'invalid') return null
  return 'search currently supports token ids, exact owner addresses, and ens names'
})

const hasError = computed(() => Boolean(databaseError.value || searchError.value))
const statusMessage = computed(() => searchError.value || databaseError.value)
const detailLoadLabel = computed(() => 'loading traits')
const visibleRows = computed(() => databaseRows.value)
const totalRows = computed(() => databaseTotalRows.value)
const pageStart = computed(() => visibleRows.value.length === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1)
const pageEnd = computed(() => Math.min(totalRows.value, (page.value - 1) * PAGE_SIZE + visibleRows.value.length))
const emptyMessage = computed(() => {
  if (databaseLoading.value) return 'loading vessels...'
  if (searchError.value) return 'invalid search'
  return 'no vessels matched'
})

function rowFromIndexer(row: TokenRow): VesselRow {
  return {
    id: Number(row.id),
    claimed: typeof row.claimed === 'boolean' ? row.claimed : null,
    loadingDetails: false,
    owner: row.owner || null,
    type: row.type || null,
    filled: typeof row.filled === 'boolean' ? row.filled : null,
    payloadBytes: numberValue(row.payloadBytes),
    capacityBytes: numberValue(row.capacityBytes) ?? Number(row.id),
    colorMode: numberValue(row.colorMode) as ColorMode | null,
    role: numberValue(row.role),
    roleLabel: row.roleLabel || null,
    axiom: Boolean(row.axiom),
    relic: Boolean(row.relic),
    relicKind: row.relicKind || null,
    machineName: row.machineName || null,
    claimBlock: numberValue(row.claimBlock),
    entryCount: numberValue(row.entryCount),
    chosenEntry: numberValue(row.chosenEntry),
    delegate: row.delegate || null,
    machineAddress: row.machineAddress || null,
    isVault: row.isVault,
    isMachine: row.isMachine,
    chosenMachine: row.chosenMachine || null,
  }
}

function numberValue(value: unknown): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function loadDatabaseRows() {
  if (searchError.value) {
    databaseToken++
    databaseLoading.value = false
    ensLoading.value = false
    databaseRows.value = []
    databaseTotalRows.value = 0
    return false
  }

  const token = ++databaseToken
  databaseLoading.value = true
  ensLoading.value = false
  databaseError.value = null

  try {
    const resolvedSearch = await searchValueForIndexer(token)
    if (token !== databaseToken) return true
    if (resolvedSearch == null) {
      databaseRows.value = []
      databaseTotalRows.value = 0
      return false
    }

    const data = await fetchTokenPage({
      page: String(page.value),
      pageSize: String(PAGE_SIZE),
      search: resolvedSearch,
      claim: claimFilter.value,
      filled: filledFilter.value,
      type: typeFilter.value,
      trait: traitFilter.value,
      color: colorFilter.value,
      sort: sortKey.value,
      dir: sortDir.value,
    })
    if (token !== databaseToken) return true

    databaseRows.value = Array.isArray(data.rows) ? data.rows.map(rowFromIndexer) : []
    databaseTotalRows.value = Number(data.total || 0)
    return true
  } catch (e: any) {
    databaseRows.value = []
    databaseTotalRows.value = 0
    databaseError.value = e?.data?.message || e?.message || 'indexer token index unavailable'
    return false
  } finally {
    if (token === databaseToken) {
      databaseLoading.value = false
      ensLoading.value = false
    }
  }
}

async function searchValueForIndexer(token: number) {
  const parsed = parseVesselSearchQuery(search.value)
  if (parsed.kind === 'empty') return ''
  if (parsed.kind === 'token' || parsed.kind === 'address') return parsed.value
  if (parsed.kind === 'invalid') return null

  ensLoading.value = true
  const resolution = await resolveEnsName(parsed.value)
  if (token !== databaseToken) return null
  return resolution.address
}

async function reload() {
  databaseError.value = null
  await loadDatabaseRows()
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
  traitFilter.value = 'all'
  colorFilter.value = 'all'
  page.value = 1
  sortKey.value = 'claimed'
  sortDir.value = 'desc'
}

function typeClass(type: string | null) {
  return type ? `color-${type}` : ''
}

function colorLabel(row: VesselRow) {
  return row.colorMode == null ? '-' : colorModeName(row.colorMode as ColorMode)
}

function roleLabel(row: VesselRow) {
  return row.roleLabel || (row.role == null ? '-' : roleFallbackLabel(row.role))
}

function roleFallbackLabel(role: number) {
  if (role === 0) return 'Undefined'
  if (role === 1) return 'Navigator'
  if (role === 2) return 'Steward'
  if (role === 3) return 'Merchant'
  return role.toLocaleString()
}

function traitLabels(row: VesselRow) {
  const labels: string[] = []
  if (row.axiom) labels.push('axiom')
  if (row.relic) labels.push(row.relicKind ? `relic: ${row.relicKind}` : 'relic')
  return labels
}

function filledLabel(row: VesselRow) {
  if (row.filled == null) return '-'
  return row.filled ? 'filled' : 'not filled'
}

function claimLabel(row: VesselRow) {
  if (row.claimed == null) return '-'
  return row.claimed ? 'claimed' : 'unclaimed'
}

function formatNullable(value: number | null) {
  return value == null ? '-' : value.toLocaleString()
}

watch(
  [search, claimFilter, filledFilter, typeFilter, traitFilter, colorFilter, sortKey, sortDir],
  () => {
    if (page.value !== 1) {
      page.value = 1
    } else {
      void loadDatabaseRows()
    }
  },
)

watch(page, () => {
  void loadDatabaseRows()
})

onMounted(() => {
  void loadDatabaseRows()
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
  min-width: 118rem;
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

.trait-list {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
}

.trait-label,
.machine-name {
  color: var(--accent);
}

.machine-name {
  margin-right: 0.4rem;
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
