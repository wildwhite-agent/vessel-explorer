<template>
  <div class="detail-page">
    <AppHeader />

    <div class="detail-content">
      <div class="nav-bar">
        <a href="#" class="back-link" @click.prevent="$router.back()">[back]</a>
        <button type="button" class="text-btn" :disabled="randomLoading" @click="randomVessel">[random]</button>
      </div>

      <div v-if="loading" class="status">loading vessel #{{ id }}...</div>
      <div v-else-if="error" class="status status-error">{{ error }}</div>

      <Transition name="vessel-in">
      <div v-if="vessel" :key="vessel.id" class="vessel-loaded">
        <div class="detail-header">
          <h1 class="vessel-title">
            vessel #{{ vessel.id }}
            <span :class="['type-badge', `type-${vessel.type}`]">[{{ vessel.type }}]</span>
            <span v-if="vessel.axiom" class="type-badge trait-badge">[axiom]</span>
            <span v-if="vessel.relic" class="type-badge trait-badge">[relic{{ vessel.relicKind ? `: ${vessel.relicKind}` : '' }}]</span>
            <span v-if="!vessel.claimed" class="type-badge unclaimed">[unclaimed]</span>
            <span v-if="vessel.locked" class="type-badge locked">[locked]</span>
          </h1>

          <div class="vessel-meta">
            <div v-if="vessel.owner" class="meta-row">
              <span class="meta-label">owner</span>
              <span class="meta-value"><AddressDisplay :address="vessel.owner" /></span>
            </div>
            <div v-if="vessel.delegate" class="meta-row">
              <span class="meta-label">delegate</span>
              <span class="meta-value"><AddressDisplay :address="vessel.delegate" /></span>
            </div>
            <div v-if="vessel.machineAddress" class="meta-row">
              <span class="meta-label">machine</span>
              <span class="meta-value">
                <AddressDisplay :address="vessel.machineAddress" external />
                <span v-if="vessel.machineName"> ({{ vessel.machineName }})</span>
              </span>
            </div>
            <div v-if="vessel.chosenMachine" class="meta-row">
              <span class="meta-label">chosen machine</span>
              <span class="meta-value"><AddressDisplay :address="vessel.chosenMachine" external /></span>
            </div>
            <div class="meta-row">
              <span class="meta-label">type</span>
              <span class="meta-value">{{ vessel.type }}</span>
            </div>
            <div v-if="vessel.roleLabel" class="meta-row">
              <span class="meta-label">role</span>
              <span class="meta-value">{{ vessel.roleLabel }}</span>
            </div>
            <div v-if="vessel.relic && vessel.relicKind" class="meta-row">
              <span class="meta-label">relic kind</span>
              <span class="meta-value">{{ vessel.relicKind }}</span>
            </div>
            <div v-if="vessel.isVault" class="meta-row">
              <span class="meta-label">entries</span>
              <span class="meta-value">{{ vessel.entryCount }}</span>
            </div>
            <div v-if="vessel.isVault" class="meta-row">
              <span class="meta-label">chosen entry</span>
              <span class="meta-value">{{ chosenEntryLabel }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">color mode</span>
              <span class="meta-value">{{ colorModeName(vessel.colorMode) }}</span>
            </div>
            <div v-if="vessel.claimBlock" class="meta-row">
              <span class="meta-label">claimed at</span>
              <span class="meta-value">block {{ vessel.claimBlock }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">capacity</span>
              <span class="meta-value">{{ vessel.id }} bytes</span>
            </div>
          </div>
        </div>

        <div v-if="vessel.isMachine && vessel.machineAddress" class="machine-note">
          sourced from <AddressDisplay :address="vessel.machineAddress" external />
        </div>

        <div v-if="vessel.isVault && vessel.entries.length > 1" class="entry-selector">
          <button
            v-for="entry in vessel.entries"
            :key="entry.entryIndex"
            :class="['entry-btn', { active: activeEntry === entry.entryIndex }]"
            @click="selectEntry(entry.entryIndex)"
          >
            entry {{ entry.entryIndex }}
          </button>
        </div>

        <ClientOnly>
          <PixelGrid
            v-if="activePayload?.length"
            :data="activePayload"
            :token-id="vessel.id"
            :show-bytes="showBytes"
            :color-mode="vessel.colorMode"
          >
            <template #actions>
              <button
                :class="['text-btn', { active: showBytes }]"
                @click="showBytes = !showBytes"
              >
                [bytes]
              </button>
              <button class="text-btn" @click="copyBytes">
                {{ copied ? '[copied]' : '[copy]' }}
              </button>
            </template>
          </PixelGrid>
          <div v-else class="status empty-label">empty</div>
        </ClientOnly>

        <ContentView
          v-if="activePayload?.length && contentType !== 'binary'"
          :data="activePayload"
        />

        <section class="write-history">
          <div class="section-header">
            <span>{{ historyTitle }}</span>
            <span class="section-count">{{ historyCountLabel }}</span>
          </div>

          <template v-if="vessel.isMachine">
            <div v-if="machineEventsLoading" class="status">loading machine history...</div>
            <div v-else-if="machineEventsError" class="status status-error">{{ machineEventsError }}</div>
            <div v-else-if="!machineRows.length" class="status">no indexed machine changes</div>

            <div v-else class="history-list">
              <article v-for="event in machineRows" :key="machineEventKey(event)" class="history-row machine-row">
                <div class="history-accent" aria-hidden="true" />
                <div class="history-content">
                  <div class="history-topline">
                    <span class="history-kind machine-kind">{{ machineEventLabel(event) }}</span>
                    <a
                      :href="`${EXPLORER_BASE}/address/${event.to}`"
                      target="_blank"
                      rel="noopener"
                      class="machine-contract-name"
                      :title="event.to"
                    >
                      {{ machineHistoryName(event.to) }}
                    </a>
                    <span class="history-time">{{ formatWriteTime(event.timeStamp) }}</span>
                  </div>

                  <div class="history-meta-grid">
                    <span v-if="event.from" class="history-meta-item">
                      <span class="history-label">setter</span>
                      <AddressDisplay :address="event.from" />
                    </span>
                    <a
                      :href="`${EXPLORER_BASE}/tx/${event.hash}`"
                      target="_blank"
                      rel="noopener"
                      class="history-meta-item explorer-link"
                    >
                      <span class="history-label">tx</span>
                      {{ shortHash(event.hash) }}
                    </a>
                    <span class="history-meta-item">
                      <span class="history-label">block</span>
                      {{ event.blockNumber }}
                    </span>
                  </div>
                </div>
              </article>
            </div>
          </template>

          <template v-else>
            <div v-if="writesLoading" class="status">loading writes...</div>
            <div v-else-if="writesError" class="status status-error">{{ writesError }}</div>
            <div v-else-if="!writeRows.length" class="status">no indexed writes</div>

            <div v-else class="history-list">
              <article v-for="write in writeRows" :key="write.id" class="history-row write-row">
                <div class="history-accent" aria-hidden="true" />
                <div class="history-content">
                  <div class="history-topline">
                    <span class="history-kind write-kind">{{ formatBytes(write.payloadBytes) }}</span>
                    <span v-if="vessel.isVault && write.entryIndex !== null" class="write-entry">
                      entry {{ write.entryIndex }}
                    </span>
                    <span class="history-time">{{ formatWriteTime(write.timestamp) }}</span>
                  </div>

                  <div class="history-meta-grid">
                    <span v-if="write.writer" class="history-meta-item">
                      <span class="history-label">writer</span>
                      <AddressDisplay :address="write.writer" />
                    </span>
                    <a
                      :href="`${EXPLORER_BASE}/tx/${write.txHash}`"
                      target="_blank"
                      rel="noopener"
                      class="history-meta-item explorer-link"
                    >
                      <span class="history-label">tx</span>
                      {{ shortHash(write.txHash) }}
                    </a>
                    <span class="history-meta-item">
                      <span class="history-label">block</span>
                      {{ write.blockNumber }}
                    </span>
                  </div>

                  <div class="write-payload-grid">
                    <div class="write-preview-frame" aria-hidden="true">
                      <ClientOnly>
                        <WritePayloadPreview
                          :payload-hex="write.payloadHex"
                          :token-id="vessel.id"
                          :color-mode="vessel.colorMode"
                        />
                      </ClientOnly>
                    </div>

                    <button
                      type="button"
                      class="write-hex"
                      :title="write.payloadHex"
                      @click="copyWriteBytes(write)"
                    >
                      <span class="write-hex-label">bytes</span>
                      <code>{{ compactHex(write.payloadHex) }}</code>
                    </button>
                  </div>
                </div>
              </article>
            </div>

            <div v-if="writeTotalPages > 1" class="write-pagination">
              <button
                type="button"
                class="text-btn"
                :disabled="writesPage <= 1 || writesLoading"
                @click="loadWrites(writesPage - 1)"
              >
                [newer]
              </button>
              <span>{{ writesPage }} / {{ writeTotalPages }}</span>
              <button
                type="button"
                class="text-btn"
                :disabled="writesPage >= writeTotalPages || writesLoading"
                @click="loadWrites(writesPage + 1)"
              >
                [older]
              </button>
            </div>
          </template>
        </section>
      </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { detectContent } from '~/utils/content'
import { fetchMachineName } from '~/utils/machine'
import { EXPLORER_BASE, colorModeName, shortenAddress } from '~/utils/vessel'
import { normalizeVesselTransaction, type VesselTransaction } from '~/utils/activity'

interface PayloadWrite {
  id: string
  tokenId: string
  entryIndex: number | null
  payloadHex: string
  payloadBytes: number
  writer: string | null
  txHash: string
  blockNumber: string
  logIndex: number | null
  timestamp: string
}

interface PayloadWriteResponse {
  rows?: PayloadWrite[]
  total?: number
  page?: number
  limit?: number
}

const WRITES_PAGE_SIZE = 25
const DETAIL_REFRESH_MS = 15_000

const router = useRouter()
const route = useRoute()

const randomVesselIds = ref<number[] | null>(null)
const randomLoading = ref(false)

function positiveIds(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  const ids = new Set<number>()
  for (const value of values) {
    const id = Number(value)
    if (Number.isInteger(id) && id > 0) ids.add(id)
  }
  return [...ids]
}

async function loadRandomVesselIds() {
  if (randomVesselIds.value?.length) return randomVesselIds.value

  randomLoading.value = true
  try {
    const { ownership } = await fetchOwnership()
    const ids = positiveIds([...ownership.keys()])
    randomVesselIds.value = ids
    return ids
  } finally {
    randomLoading.value = false
  }
}

async function randomVessel() {
  const candidates = (await loadRandomVesselIds()).filter((candidate) => candidate !== id.value)
  if (!candidates.length) return
  const pick = candidates[Math.floor(Math.random() * candidates.length)]
  router.push(`/${pick}`)
}

const id = computed(() => {
  const raw = route.params.id as string
  const n = parseInt(raw, 10)
  return isNaN(n) ? undefined : n
})

const { vessel, loading, error, refresh } = useVesselReader(id)

const showBytes = ref(false)
const copied = ref(false)
const writesLoading = ref(false)
const writesError = ref('')
const writeRows = ref<PayloadWrite[]>([])
const writeTotal = ref(0)
const writesPage = ref(1)
let writesRequestId = 0
const machineEventsLoading = ref(false)
const machineEventsError = ref('')
const machineRows = ref<VesselTransaction[]>([])
const machineNames = ref<Record<string, string | null>>({})
let machineEventsRequestId = 0

const activeEntry = ref(0)
const entrySelectionTouched = ref(false)
watch(
  () => [
    vessel.value?.id,
    vessel.value?.isVault,
    latestEntryIndex(vessel.value?.entries ?? []),
  ] as const,
  ([vesselId, isVault, latest], previous) => {
    const previousVesselId = previous?.[0]
    const previousLatest = previous?.[2]

    if (!vesselId || !isVault || !vessel.value?.entries.length) {
      activeEntry.value = 0
      entrySelectionTouched.value = false
      return
    }

    if (vesselId !== previousVesselId) entrySelectionTouched.value = false
    if (!entrySelectionTouched.value || activeEntry.value === previousLatest) {
      activeEntry.value = latest
    }
  },
  { immediate: true },
)

function selectEntry(entryIndex: number) {
  activeEntry.value = entryIndex
  entrySelectionTouched.value = true
}

async function refreshDetail() {
  if (!id.value) return
  if (typeof document !== 'undefined' && document.hidden) return

  await refresh()
  if (!vessel.value) return

  if (vessel.value.isMachine) {
    await loadMachineEvents()
  } else {
    await loadWrites(1)
  }
}

onMounted(() => {
  const refreshInterval = window.setInterval(() => {
    void refreshDetail()
  }, DETAIL_REFRESH_MS)

  onUnmounted(() => {
    window.clearInterval(refreshInterval)
  })
})

const activePayload = computed(() => {
  if (!vessel.value) return null
  if (vessel.value.isVault && vessel.value.entries.length > 0) {
    const entry =
      vessel.value.entries.find((candidate) => candidate.entryIndex === activeEntry.value) ??
      vessel.value.entries[vessel.value.entries.length - 1]
    return entry?.payload || null
  }
  return vessel.value.payload
})

const chosenEntryLabel = computed(() => {
  if (!vessel.value?.isVault) return ''
  return vessel.value.chosenEntry === 0 ? 'latest' : String(vessel.value.chosenEntry)
})

function latestEntryIndex(entries: Array<{ entryIndex: number }>) {
  return entries[entries.length - 1]?.entryIndex ?? 0
}

const contentType = computed(() => {
  if (!activePayload.value?.length) return 'binary'
  return detectContent(activePayload.value).type
})

const writeTotalPages = computed(() => Math.max(1, Math.ceil(writeTotal.value / WRITES_PAGE_SIZE)))
const writeCountLabel = computed(() => {
  if (writesLoading.value && !writeRows.value.length) return 'loading'
  if (writeTotal.value === 1) return '1 write'
  return `${writeTotal.value} writes`
})
const machineCountLabel = computed(() => {
  if (machineEventsLoading.value && !machineRows.value.length) return 'loading'
  if (machineRows.value.length === 1) return '1 change'
  return `${machineRows.value.length} changes`
})
const historyTitle = computed(() => vessel.value?.isMachine ? 'machine history' : 'write history')
const historyCountLabel = computed(() => vessel.value?.isMachine ? machineCountLabel.value : writeCountLabel.value)

watch(() => [vessel.value?.machineAddress, vessel.value?.machineName] as const, ([address, name]) => {
  if (!address || !name) return
  machineNames.value = {
    ...machineNames.value,
    [machineAddressKey(address)]: name,
  }
})

watch(() => [id.value, vessel.value?.isMachine] as const, ([tokenId, isMachine]) => {
  if (!tokenId || isMachine === undefined) {
    clearHistory()
    return
  }

  if (isMachine) {
    void loadMachineEvents()
  } else {
    void loadWrites(1)
  }
}, { immediate: true })

// OG meta tags are injected server-side by server/plugins/og-meta.ts
useHead(() => ({
  title: id.value ? `vessel #${id.value}` : 'vessel explorer',
}))

async function copyBytes() {
  if (!activePayload.value) return
  const hex = Array.from(activePayload.value)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  await navigator.clipboard.writeText('0x' + hex)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

async function copyWriteBytes(write: PayloadWrite) {
  await navigator.clipboard.writeText(write.payloadHex)
}

function clearHistory() {
  writeRows.value = []
  writeTotal.value = 0
  writesPage.value = 1
  writesError.value = ''
  machineRows.value = []
  machineEventsError.value = ''
}

async function loadWrites(page: number) {
  const tokenId = id.value
  if (!tokenId) {
    writeRows.value = []
    writeTotal.value = 0
    writesPage.value = 1
    writesError.value = ''
    return
  }

  const requestId = ++writesRequestId
  machineRows.value = []
  machineEventsError.value = ''
  writesLoading.value = true
  writesError.value = ''

  try {
    const data = await $fetch<PayloadWriteResponse>(`/api/tokens/${tokenId}/writes`, {
      query: {
        page,
        limit: WRITES_PAGE_SIZE,
        dir: 'desc',
      },
    })
    if (requestId !== writesRequestId) return
    writeRows.value = Array.isArray(data.rows) ? data.rows : []
    writeTotal.value = Number(data.total) || 0
    writesPage.value = Number(data.page) || page
  } catch (err: any) {
    if (requestId !== writesRequestId) return
    writeRows.value = []
    writeTotal.value = 0
    writesPage.value = 1
    writesError.value = err?.data?.message || err?.message || 'failed to load write history'
  } finally {
    if (requestId === writesRequestId) writesLoading.value = false
  }
}

async function loadMachineEvents() {
  const tokenId = id.value
  if (!tokenId) {
    clearHistory()
    return
  }

  const requestId = ++machineEventsRequestId
  writeRows.value = []
  writeTotal.value = 0
  writesError.value = ''
  machineEventsLoading.value = true
  machineEventsError.value = ''

  try {
    const rows = await $fetch<VesselTransaction[]>('/api/activity', {
      query: {
        tokenId,
        type: 'machine',
        limit: 50,
      },
    })
    if (requestId !== machineEventsRequestId) return
    machineRows.value = Array.isArray(rows) ? rows.map(normalizeVesselTransaction) : []
    void loadMachineNames(machineRows.value)
  } catch (err: any) {
    if (requestId !== machineEventsRequestId) return
    machineRows.value = []
    machineEventsError.value = err?.data?.message || err?.message || 'failed to load machine history'
  } finally {
    if (requestId === machineEventsRequestId) machineEventsLoading.value = false
  }
}

function machineAddressKey(address: string) {
  return address.toLowerCase()
}

function machineHistoryName(address: string) {
  return machineNames.value[machineAddressKey(address)] || shortenAddress(address)
}

function machineEventLabel(event: VesselTransaction) {
  return event.automatic ? 'set at claim' : 'configured machine'
}

function machineEventKey(event: VesselTransaction) {
  return event.id || `${event.hash}-${event.logIndex ?? 'machine'}`
}

async function loadMachineNames(rows: VesselTransaction[]) {
  const addresses = [...new Set(rows.map((row) => row.to).filter(Boolean))]
  await Promise.all(addresses.map(async (address) => {
    const key = machineAddressKey(address)
    if (Object.prototype.hasOwnProperty.call(machineNames.value, key)) return

    const name = await fetchMachineName(address as `0x${string}`)
    machineNames.value = {
      ...machineNames.value,
      [key]: name,
    }
  }))
}

function formatBytes(bytes: number) {
  return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
}

function formatWriteTime(timestamp: string) {
  const date = new Date(Number(timestamp) * 1000)
  if (Number.isNaN(date.getTime())) return 'unknown time'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function compactHex(hex: string) {
  const value = hex?.startsWith('0x') ? hex : `0x${hex || ''}`
  if (value.length <= 98) return value
  return `${value.slice(0, 66)}...${value.slice(-16)}`
}

function shortHash(hash: string) {
  if (!hash) return ''
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`
}
</script>

<style scoped>
.detail-page {
  font-family: var(--font-mono);
  max-width: 960px;
  margin: 0 auto;
}

.detail-content {
  padding: 1rem;
}

.nav-bar {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
}

.empty-label {
  text-align: center;
  padding: 3rem 0;
}

.detail-header {
  margin-bottom: 1.5rem;
}

.vessel-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 1rem 0;
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.type-badge {
  font-size: 13px;
  font-weight: 700;
  text-transform: lowercase;
}

.type-capsule { color: var(--color-capsule); }
.type-vault { color: var(--color-vault); }
.type-machine { color: var(--color-machine); }
.unclaimed { color: var(--text-faint); }
.locked { color: var(--error, #e06c75); }
.trait-badge { color: var(--accent); }

.vessel-meta {
  font-size: 13px;
}

.meta-row {
  display: flex;
  gap: 1rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--border-color);
}

.meta-label {
  color: var(--muted);
  width: 7rem;
  flex-shrink: 0;
}

.meta-value {
  color: var(--color);
  overflow: hidden;
  text-overflow: ellipsis;
}

.machine-note {
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 0.75rem;
}

.entry-selector {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr));
  gap: 0.25rem;
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
}

.entry-btn {
  background: none;
  border: 1px solid var(--border-color);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  min-width: 5rem;
  height: 1.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;

  &:hover {
    color: var(--color);
  }

  &.active {
    color: var(--accent);
    border-color: var(--accent);
    font-weight: 700;
  }
}

.section-header {
  height: 2rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border-color);
  background: var(--bg-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  box-sizing: border-box;
}

.section-count {
  color: var(--text-faint);
}

.write-history {
  margin-top: 1.5rem;
  font-size: 13px;
}

.history-list {
  border: 1px solid var(--border-color);
  border-top: 0;
}

.history-row {
  display: grid;
  grid-template-columns: 0.25rem minmax(0, 1fr);
  border-bottom: 1px solid var(--border-color);
  background: var(--background);
  box-sizing: border-box;

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: var(--bg-subtle);
  }
}

.history-accent {
  background: var(--muted);
}

.write-row .history-accent {
  background: var(--write);
}

.machine-row .history-accent {
  background: var(--color-machine);
}

.history-content {
  min-width: 0;
  padding: 0.7rem 0.75rem 0.75rem;
}

.history-topline {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 0.75rem;
  min-width: 0;
}

.machine-row .history-topline {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.history-kind {
  font-weight: 700;
  white-space: nowrap;
}

.write-kind {
  color: var(--write);
}

.machine-kind {
  color: var(--color-machine);
}

.write-entry,
.history-time {
  color: var(--muted);
  white-space: nowrap;
}

.history-time {
  grid-column: 3;
  justify-self: end;
}

.write-entry {
  white-space: nowrap;
}

.history-meta-grid {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  margin-top: 0.35rem;
  color: var(--muted);
  font-size: 12px;
}

.history-meta-item {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
  color: var(--muted);
}

.history-label {
  color: var(--text-faint);
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0;
}

.explorer-link {
  color: var(--muted);
  text-decoration: none;

  &:hover {
    color: var(--color);
  }
}

.machine-contract-name {
  min-width: 0;
  overflow: hidden;
  color: var(--color);
  font-weight: 700;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    text-decoration: underline;
  }
}

.write-payload-grid {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr);
  align-items: stretch;
  gap: 0.65rem;
  margin-top: 0.6rem;
}

.write-preview-frame {
  display: grid;
  place-items: center;
  min-block-size: 4.75rem;
  min-inline-size: 0;
  padding: 0.35rem;
  border: 1px solid var(--border-color);
  background: var(--background);
  box-sizing: border-box;
  overflow: hidden;
}

.write-hex {
  display: grid;
  grid-template-columns: 1fr;
  align-content: center;
  gap: 0.25rem;
  inline-size: 100%;
  block-size: auto;
  min-block-size: 4.75rem;
  min-inline-size: 0;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--border-color);
  border-radius: 0;
  background: var(--bg-subtle);
  box-shadow: none;
  box-sizing: border-box;
  color: var(--text-faint);
  cursor: copy;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.35;
  text-align: left;
  user-select: text;

  &:hover {
    border-color: var(--muted);
    color: var(--color);
  }

  code {
    min-width: 0;
    overflow: hidden;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.write-hex-label {
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
}

.write-pagination {
  min-height: 2rem;
  border: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0 0.75rem;
  color: var(--muted);
  font-size: 12px;
}

.text-btn:disabled {
  color: var(--text-faint);
  cursor: default;
}

.vessel-in-enter-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}

.vessel-in-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 640px) {
  .vessel-title {
    font-size: 16px;
  }

  .meta-row {
    flex-direction: column;
    gap: 0.15rem;
  }

  .meta-label {
    width: auto;
  }

  .meta-value {
    word-break: break-all;
  }

  .entry-btn {
    min-width: 4rem;
    font-size: 11px;
  }

  .section-header,
  .write-pagination {
    padding-inline: 0.5rem;
  }

  .history-content {
    padding-inline: 0.5rem;
  }

  .history-topline,
  .machine-row .history-topline {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.35rem 0.5rem;
  }

  .history-kind,
  .write-entry {
    grid-column: 1;
  }

  .history-time {
    grid-column: 2;
    justify-self: end;
  }

  .history-time {
    grid-row: 1;
    font-size: 12px;
  }

  .machine-contract-name {
    grid-column: 1 / -1;
  }

  .write-payload-grid {
    grid-template-columns: 4.75rem minmax(0, 1fr);
    gap: 0.45rem;
  }

  .write-preview-frame,
  .write-hex {
    min-block-size: 4.25rem;
  }
}
</style>
