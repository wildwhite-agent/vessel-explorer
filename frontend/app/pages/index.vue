<template>
  <div class="index-page">
    <AppHeader />

    <div class="search-section">
      <form @submit.prevent="goToVessel" class="search-form">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="enter vessel id or address..."
          class="search-input"
        />
        <button type="submit" class="text-btn">[go]</button>
        <button type="button" class="text-btn" @click="randomVessel">[random]</button>
      </form>
    </div>

    <div class="feed-section">
      <div class="tab-bar">
        <span :class="['tab-link', { active: activeTab === 'activity' }]" @click="activeTab = 'activity'">recent activity</span>
        <span class="tab-divider">/</span>
        <span :class="['tab-link', { active: activeTab === 'holders' }]" @click="activeTab = 'holders'">holders</span>
        <span class="tab-divider">/</span>
        <span :class="['tab-link', { active: activeTab === 'heatmap' }]" @click="activeTab = 'heatmap'">heatmap</span>
      </div>

      <!-- Holders tab -->
      <div v-if="activeTab === 'holders'">
        <div v-if="holdersLoading && holders.length === 0" class="feed-status">loading holders...</div>
        <div v-else-if="holdersError" class="feed-status feed-error">{{ holdersError }}</div>
        <div v-else-if="holders.length === 0" class="feed-status">no holders yet</div>
        <div v-else class="feed-table">
          <div class="feed-row feed-row-header holder-row">
            <span class="col-rank">#</span>
            <span class="col-holder">address</span>
            <span class="col-stat">total</span>
            <span class="col-stat">machines</span>
            <span class="col-stat">vaults</span>
            <span class="col-stat">capsules</span>
          </div>
          <div
            v-for="(holder, i) in holders"
            :key="holder.address"
            class="feed-row holder-row"
          >
            <span class="col-rank">{{ i + 1 }}</span>
            <span class="col-holder">
              <NuxtLink :to="`/address/${holder.address}`" class="vessel-link">
                <AddressDisplay :address="holder.address" :link="false" />
              </NuxtLink>
            </span>
            <span class="col-stat">{{ holder.count }}</span>
            <span class="col-stat">{{ holder.machines }}</span>
            <span class="col-stat">{{ holder.vaults }}</span>
            <span class="col-stat">{{ holder.capsules }}</span>
          </div>
        </div>
      </div>

      <!-- Heatmap tab -->
      <ActivityHeatmap
        v-else-if="activeTab === 'heatmap'"
        :data="heatmap"
        :loading="heatmapLoading"
        :error="heatmapError"
      />

      <!-- Activity tab -->
      <div v-else>
        <div class="feed-filters">
          <button
            v-for="action in actionTypes"
            :key="action"
            :class="['filter-btn', `action-${action}`, { inactive: !activeFilters.has(action) }]"
            @click="toggleFilter(action)"
          >
            {{ activityLabel(action) }}
          </button>
        </div>

        <div v-if="feedLoading" class="feed-status">loading...</div>
        <div v-else-if="feedError" class="feed-status feed-error">{{ feedError }}</div>

        <div v-else class="feed-table">
        <template v-for="(group, gi) in activityGroups" :key="gi">
          <div class="feed-date-separator">{{ group.label }}</div>
          <div
            v-for="tx in group.txs"
            :key="activityKey(tx)"
            class="feed-row"
          >
            <span class="col-action">
              <span
                class="action-badge"
                :class="`action-${tx.action}`"
                :title="tx.action"
              >
                {{ tx.action }}
              </span>
            </span>
            <span class="col-id vessel-id-cell">
              <NuxtLink
                v-if="tx.vesselId"
                :to="`/${tx.vesselId}`"
                class="vessel-link"
                @mouseenter="showVesselPreview(tx.vesselId, $event)"
                @mouseleave="hidePreview"
              >
                #{{ tx.vesselId }}
              </NuxtLink>
              <NuxtLink
                v-else-if="tx.action === 'sequencemint' && tx.subjectId"
                :to="`/sequences/${tx.subjectId}`"
                class="vessel-link subject-preview-trigger"
                @mouseenter="showSequencePreview(tx, $event)"
                @mouseleave="hidePreview"
              >
                seq #{{ tx.subjectId }}
              </NuxtLink>
              <span v-else class="text-faint">--</span>
            </span>
            <span class="col-from">
              <template v-if="tx.action === 'sale'">
                <span class="sale-parties">
                  <AddressDisplay :address="tx.buyer || tx.from" />
                  <span class="sale-separator">from</span>
                  <AddressDisplay :address="tx.seller || tx.to" />
                </span>
              </template>
              <AddressDisplay v-else :address="tx.from" />
            </span>
            <span class="col-price">
              {{ activityValue(tx) }}
            </span>
            <a
              :href="`${EXPLORER_BASE}/tx/${tx.hash}`"
              target="_blank"
              rel="noopener"
              class="col-time explorer-link"
            >
              {{ formatTime(tx.timeStamp) }}
            </a>
          </div>
        </template>
        <div v-if="feedLoadingMore" class="feed-status">loading more...</div>
        <div ref="sentinel" class="feed-sentinel" />
      </div>
    </div>
    </div>

    <!-- Hover preview tooltip -->
    <div
      v-if="preview.visible"
      class="preview-tooltip"
      :style="{ top: preview.y + 'px', left: preview.x + 'px' }"
    >
      <img
        v-if="preview.imageUrl"
        :src="preview.imageUrl"
        alt=""
        class="preview-image"
      />
      <canvas v-else ref="previewCanvas" class="preview-canvas pixelated" />
      <div v-if="preview.loading" class="preview-loading">...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fetchDailyActivity, fetchVesselActivity, type DailyActivityResponse, type VesselTransaction } from '~/utils/activity'
import { EXPLORER_BASE, renderToCanvas, type ColorMode } from '~/utils/vessel'
import { bytesFromHex, fetchHolders, fetchToken } from '~/utils/indexer'

const router = useRouter()

const searchQuery = ref('')
const activeTab = ref<'activity' | 'holders' | 'heatmap'>('activity')
const activity = ref<VesselTransaction[]>([])
const feedLoading = ref(true)
const feedError = ref<string | null>(null)
const feedPage = ref(1)
const feedLoadingMore = ref(false)
const feedExhausted = ref(false)
const sentinel = ref<HTMLElement | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)

const actionTypes = ['claim', 'sale', 'write', 'transfer', 'machine', 'delegate', 'setvaultentry', 'vwuclaim', 'sequencemint'] as const
const activeFilters = ref(new Set<string>(actionTypes))
const ACTIVITY_REFRESH_MS = 15_000

interface Holder {
  address: string
  count: number
  machines: number
  vaults: number
  capsules: number
}
const holders = ref<Holder[]>([])
const holdersLoading = ref(false)
const holdersLoaded = ref(false)
const holdersError = ref<string | null>(null)
let holdersRequest: Promise<void> | null = null
const heatmap = ref<DailyActivityResponse | null>(null)
const heatmapLoading = ref(false)
const heatmapLoaded = ref(false)
const heatmapError = ref<string | null>(null)
let heatmapRequest: Promise<void> | null = null

async function loadHolders() {
  if (holdersLoaded.value) return
  if (holdersRequest) return await holdersRequest

  holdersLoading.value = true
  holdersError.value = null
  holdersRequest = (async () => {
    try {
      holders.value = (await fetchHolders(500)).map((holder) => ({
        address: holder.address,
        count: Number(holder.count || 0),
        machines: Number(holder.machines || 0),
        vaults: Number(holder.vaults || 0),
        capsules: Number(holder.capsules || 0),
      }))
      holdersLoaded.value = true
    } catch (e: any) {
      holdersError.value = e?.data?.message || e?.message || 'failed to load holders'
    } finally {
      holdersLoading.value = false
      holdersRequest = null
    }
  })()

  return await holdersRequest
}

async function loadHeatmap() {
  if (heatmapLoaded.value) return
  if (heatmapRequest) return await heatmapRequest

  heatmapLoading.value = true
  heatmapError.value = null
  heatmapRequest = (async () => {
    try {
      heatmap.value = await fetchDailyActivity()
      heatmapLoaded.value = true
    } catch (e: any) {
      heatmapError.value = e?.data?.message || e?.message || 'failed to load heatmap'
    } finally {
      heatmapLoading.value = false
      heatmapRequest = null
    }
  })()

  return await heatmapRequest
}

watch(activeTab, async (tab) => {
  if (tab === 'holders' && !holdersLoaded.value) {
    void loadHolders()
  }
  if (tab === 'heatmap' && !heatmapLoaded.value) {
    void loadHeatmap()
  }
})

// Group activity by day
const activityGroups = computed(() => {
  const groups: { label: string; txs: VesselTransaction[] }[] = []
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400_000

  let currentLabel = ''
  let currentGroup: VesselTransaction[] = []

  const filtered = activity.value.filter(tx => activeFilters.value.has(tx.action))
  for (const tx of filtered) {
    const ts = Number(tx.timeStamp) * 1000
    let label: string
    if (ts >= todayStart) label = 'today'
    else if (ts >= yesterdayStart) label = 'yesterday'
    else {
      const d = new Date(ts)
      label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    if (label !== currentLabel) {
      if (currentGroup.length) groups.push({ label: currentLabel, txs: currentGroup })
      currentLabel = label
      currentGroup = [tx]
    } else {
      currentGroup.push(tx)
    }
  }
  if (currentGroup.length) groups.push({ label: currentLabel, txs: currentGroup })
  return groups
})

// Vessel IDs that have data (from write actions in feed)
const activeVesselIds = computed(() => {
  const ids = new Set<string>()
  for (const tx of activity.value) {
    if (tx.vesselId && tx.action === 'write') ids.add(tx.vesselId)
  }
  return [...ids]
})

const preview = reactive({
  visible: false,
  loading: false,
  x: 0,
  y: 0,
  key: null as string | null,
  vesselId: null as string | null,
  imageUrl: null as string | null,
})

// Cache fetched payloads and color modes
const payloadCache = new Map<string, Uint8Array>()
const colorModeCache = new Map<string, ColorMode>()

function goToVessel() {
  const q = searchQuery.value.trim()
  if (!q) return
  if (q.startsWith('0x') && q.length === 42) {
    router.push(`/address/${q}`)
  } else if (/^\d+$/.test(q)) {
    router.push(`/${q}`)
  }
}

function randomVessel() {
  if (activeVesselIds.value.length === 0) return
  const id = activeVesselIds.value[Math.floor(Math.random() * activeVesselIds.value.length)]
  router.push(`/${id}`)
}

function formatTime(ts: string): string {
  const d = new Date(Number(ts) * 1000)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

async function showVesselPreview(vesselId: string, event: MouseEvent) {
  const rect = (event.target as HTMLElement).getBoundingClientRect()
  const key = `vessel:${vesselId}`
  preview.x = rect.left
  preview.y = rect.bottom + 8
  preview.key = key
  preview.vesselId = vesselId
  preview.imageUrl = null
  preview.visible = true
  preview.loading = true

  let payload = payloadCache.get(vesselId)
  let colorMode = colorModeCache.get(vesselId) ?? 0 as ColorMode
  if (!payload) {
    try {
      const token = await fetchToken(Number(vesselId))
      colorMode = Number(token.colorMode || 0) as ColorMode
      colorModeCache.set(vesselId, colorMode)
      const bytes = bytesFromHex(token.payloadHex)
      if (bytes.length > 0) {
        payload = bytes
        payloadCache.set(vesselId, payload)
      }
    } catch {}
  }

  // Still hovering the same vessel?
  if (preview.key !== key) return
  preview.loading = false

  if (payload?.length) {
    await nextTick()
    renderPreview(payload, Number(vesselId), colorMode)
  }
}

function showSequencePreview(tx: VesselTransaction, event: MouseEvent) {
  if (!tx.subjectId) return
  const rect = (event.target as HTMLElement).getBoundingClientRect()
  preview.x = rect.left
  preview.y = rect.bottom + 8
  preview.key = `sequence:${tx.subjectId}:${tx.hash}`
  preview.vesselId = null
  preview.imageUrl = sequenceImageUrl(tx)
  preview.visible = true
  preview.loading = false
}

function hidePreview() {
  preview.visible = false
  preview.key = null
  preview.vesselId = null
  preview.imageUrl = null
}

function renderPreview(data: Uint8Array, tokenId: number, colorMode: ColorMode = 0) {
  const canvas = previewCanvas.value
  if (!canvas) return
  renderToCanvas(canvas, data, tokenId, 80, colorMode)
}

const showActions = new Set(['claim', 'sale', 'transfer', 'write', 'machine', 'delegate', 'setvaultentry', 'vwuclaim', 'sequencemint'])

function activityKey(tx: VesselTransaction) {
  return `${tx.hash}-${tx.action}-${tx.vesselId ?? tx.subjectId ?? ''}-${tx.amount ?? ''}-${tx.blockNumber}`
}

function activityLabel(action: string) {
  switch (action) {
    case 'vwuclaim':
      return 'vwu claim'
    case 'sequencemint':
      return 'sequence mint'
    default:
      return action
  }
}

function activityValue(tx: VesselTransaction) {
  if (tx.action === 'sale') return tx.salePrice?.formatted || 'mixed payment'
  if (tx.action === 'vwuclaim') return `${formatInteger(tx.amount)} VWU`
  if (tx.action === 'sequencemint') return `x${formatInteger(tx.amount)}`
  return ''
}

function formatInteger(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return '0'
  try {
    return BigInt(value).toLocaleString('en-US')
  } catch {
    return Number(value || 0).toLocaleString()
  }
}

function sequenceImageUrl(tx: VesselTransaction) {
  const id = tx.subjectId || tx.sequence?.tokenId
  const version = encodeURIComponent([
    tx.sequence?.blockNumber || tx.blockNumber,
    tx.hash,
    tx.amount || '0',
  ].join('-'))
  return `/api/sequence-og/${id}?v=${version}`
}

function toggleFilter(action: string) {
  const f = activeFilters.value
  if (f.has(action)) {
    if (f.size > 1) f.delete(action)
  } else {
    f.add(action)
  }
  activeFilters.value = new Set(f)
}

async function loadPage(page: number) {
  const all = await fetchVesselActivity(page)
  const filtered = all.filter(tx => tx.isError !== '1' && showActions.has(tx.action))
  if (all.length === 0) feedExhausted.value = true
  return filtered
}

async function loadMore() {
  if (feedLoadingMore.value || feedExhausted.value) return
  feedLoadingMore.value = true
  try {
    feedPage.value++
    const more = await loadPage(feedPage.value)
    if (more.length === 0) {
      feedExhausted.value = true
    } else {
      activity.value.push(...more)
    }
  } catch { /* silently fail */ }
  finally { feedLoadingMore.value = false }
}

async function refreshLatestActivity() {
  if (activeTab.value !== 'activity' || feedLoading.value || feedLoadingMore.value) return
  if (typeof document !== 'undefined' && document.hidden) return

  try {
    const latest = await loadPage(1)
    if (!latest.length) return

    const latestKeys = new Set(latest.map(activityKey))
    const maxRows = Math.max(1, feedPage.value) * 50
    activity.value = [
      ...latest,
      ...activity.value.filter((tx) => !latestKeys.has(activityKey(tx))),
    ].slice(0, maxRows)
    feedError.value = null
  } catch {
    // Keep the existing feed visible if a background refresh fails.
  }
}

onMounted(async () => {
  try {
    activity.value = await loadPage(1)
  } catch (e: any) {
    feedError.value = e?.message || 'failed to fetch activity'
  } finally {
    feedLoading.value = false
  }

  // Infinite scroll via IntersectionObserver
  const observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && activeTab.value === 'activity') loadMore()
  }, { rootMargin: '200px' })

  watch(sentinel, (el) => {
    if (el) observer.observe(el)
  }, { immediate: true })

  const refreshInterval = window.setInterval(() => {
    void refreshLatestActivity()
  }, ACTIVITY_REFRESH_MS)

  onUnmounted(() => {
    observer.disconnect()
    window.clearInterval(refreshInterval)
  })
})
</script>

<style scoped>
.index-page {
  font-family: var(--font-mono);
  max-width: 960px;
  margin: 0 auto;
}

.search-section {
  padding: 2rem 1rem 1rem;
  border-bottom: 1px solid var(--border-color);
}

.search-form {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  max-width: 500px;
}

.search-input {
  flex: 1;
  background: var(--bg-subtle);
  border: 1px solid var(--border-color);
  color: var(--color);
  font-family: var(--font-mono);
  font-size: 14px;
  padding: 0.5rem 0.75rem;
  outline: none;

  &:focus {
    border-color: var(--accent);
  }

  &::placeholder {
    color: var(--text-faint);
  }
}

.feed-section {
  padding: 1rem;
}

.tab-bar {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.tab-link {
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
  text-transform: lowercase;

  &:hover {
    color: var(--color);
  }

  &.active {
    color: var(--color);
  }
}

.tab-divider {
  color: var(--text-faint);
  font-size: 13px;
}

.holder-row.feed-row {
  grid-template-columns: 2rem minmax(12rem, 1fr) repeat(4, 4.5rem);
}

.dimmed {
  color: var(--text-faint);
}

.col-rank {
  color: var(--text-faint);
}

.col-holder {
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-stat {
  text-align: right;
  font-size: 12px;
}

.feed-status {
  color: var(--muted);
  font-size: 13px;
  padding: 1rem 0;
}

.feed-error {
  color: var(--error);
}

.feed-sentinel {
  height: 1px;
}

.feed-table {
  font-size: 13px;
  overflow-x: auto;
}

.feed-filters {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.filter-btn {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  text-transform: lowercase;
  padding: 6px 10px !important;
  margin: 0 !important;
  border-radius: 2px;
  border: none !important;
  box-shadow: none !important;
  cursor: pointer;
  background: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  height: auto !important;
  min-height: 0 !important;
  block-size: auto !important;
  min-inline-size: 0 !important;

  &.inactive {
    opacity: 0.3;
  }
}

.feed-date-separator {
  color: var(--text-faint);
  font-size: 11px;
  text-transform: lowercase;
  padding: 0.6rem 0 0.25rem;
  letter-spacing: 0.05em;

  &:first-child {
    padding-top: 0;
  }
}

.feed-row {
  display: grid;
  grid-template-columns: 7rem 5.5rem minmax(0, 1fr) 6.75rem 5rem;
  gap: 0.5rem;
  padding: 0.35rem 0.25rem;
  border-bottom: 1px solid var(--border-color);
  align-items: baseline;
  white-space: nowrap;

  &:hover {
    background: var(--bg-subtle);
  }
}

.feed-row-header {
  color: var(--muted);
  font-weight: 700;
  text-transform: lowercase;
}

.col-from {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
}

.col-action {
  min-width: 0;
}

.col-time {
  color: var(--text-faint);
  text-align: right;
}

.col-price {
  color: var(--color);
  font-size: 12px;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
}

.sale-parties {
  display: flex;
  gap: 0.35rem;
  min-width: 0;
  overflow: hidden;
}

.sale-parties :deep(.address-display) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sale-separator {
  color: var(--text-faint);
  flex-shrink: 0;
}

.vessel-id-cell {
  position: relative;
}

.action-badge {
  display: inline-block;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  font-size: 11px;
  font-weight: 700;
  text-transform: lowercase;
  padding: 1px 5px;
  border-radius: 2px;
}

.action-claim { color: var(--color-capsule); background: rgba(34, 211, 238, 0.2); }
.action-write { color: var(--write, #f59e0b); background: rgba(245, 158, 11, 0.2); }
.action-delegate { color: #60a5fa; background: rgba(96, 165, 250, 0.2); }
.action-machine { color: var(--color-machine); background: rgba(167, 139, 250, 0.2); }
.action-transfer { color: var(--muted); background: rgba(128, 128, 128, 0.15); }
.action-sale { color: #34d399; background: rgba(52, 211, 153, 0.18); }
.action-role { color: #f472b6; background: rgba(244, 114, 182, 0.2); }
.action-setvaultentry { color: var(--color-vault); background: rgba(74, 222, 128, 0.2); }
.action-vwuclaim { color: #fbbf24; background: rgba(251, 191, 36, 0.2); }
.action-sequencemint { color: #f472b6; background: rgba(244, 114, 182, 0.18); }

.vessel-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 700;

  &:hover {
    text-decoration: underline;
  }
}

.explorer-link {
  color: var(--text-faint);
  text-decoration: none;

  &:hover {
    color: var(--color);
  }
}

.subject-preview-trigger {
  cursor: default;
}

.preview-tooltip {
  position: fixed;
  z-index: 50;
  background: var(--bg-subtle);
  border: 1px solid var(--border-color);
  padding: 4px;
  pointer-events: none;
}

.preview-canvas {
  display: block;
}

.preview-image {
  display: block;
  width: 120px;
  max-width: 180px;
  max-height: 180px;
  object-fit: contain;
}

.preview-loading {
  color: var(--text-faint);
  font-size: 11px;
  padding: 0.5rem;
}

@media (max-width: 640px) {
  .feed-row {
    grid-template-columns: 5.75rem 4.25rem minmax(0, 1fr) 4.25rem;
    font-size: 12px;
  }

  .col-price {
    display: none;
  }
}
</style>
