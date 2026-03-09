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
        <span :class="['tab-link', { active: activeTab === 'activity' }]" @click="activeTab = 'activity'">recent vessel activity</span>
        <span class="tab-divider">/</span>
        <span :class="['tab-link', { active: activeTab === 'holders' }]" @click="activeTab = 'holders'">holders</span>
      </div>

      <!-- Holders tab -->
      <div v-if="activeTab === 'holders'">
        <div v-if="holdersLoading" class="feed-status">loading holders...</div>
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
                <AddressDisplay :address="holder.address" />
              </NuxtLink>
            </span>
            <span class="col-stat">{{ holder.count }}</span>
            <span class="col-stat" :class="{ dimmed: !holder.typesLoaded }">{{ holder.typesLoaded ? (holder.machines || '-') : '...' }}</span>
            <span class="col-stat" :class="{ dimmed: !holder.typesLoaded }">{{ holder.typesLoaded ? (holder.vaults || '-') : '...' }}</span>
            <span class="col-stat" :class="{ dimmed: !holder.typesLoaded }">{{ holder.typesLoaded ? (holder.capsules || '-') : '...' }}</span>
          </div>
        </div>
      </div>

      <!-- Activity tab -->
      <div v-else>
        <div v-if="feedLoading" class="feed-status">loading...</div>
        <div v-else-if="feedError" class="feed-status feed-error">{{ feedError }}</div>

        <div v-else class="feed-table">
        <template v-for="(group, gi) in activityGroups" :key="gi">
          <div class="feed-date-separator">{{ group.label }}</div>
          <div
            v-for="tx in group.txs"
            :key="tx.hash"
            class="feed-row"
          >
            <span class="col-action">
              <span class="action-badge" :class="`action-${tx.action}`">{{ tx.action }}</span>
            </span>
            <span class="col-id vessel-id-cell">
              <NuxtLink
                v-if="tx.vesselId"
                :to="`/${tx.vesselId}`"
                class="vessel-link"
                @mouseenter="showPreview(tx.vesselId, $event)"
                @mouseleave="hidePreview"
              >
                #{{ tx.vesselId }}
              </NuxtLink>
              <span v-else class="text-faint">--</span>
            </span>
            <span class="col-from">
              <AddressDisplay :address="tx.from" />
            </span>
            <a
              :href="`${ETHERSCAN_BASE}/tx/${tx.hash}`"
              target="_blank"
              rel="noopener"
              class="col-time etherscan-link"
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
      <canvas ref="previewCanvas" class="preview-canvas pixelated" />
      <div v-if="preview.loading" class="preview-loading">...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { readContract } from '@wagmi/core'
import { useConfig } from '@wagmi/vue'
import { fetchVesselActivity, type VesselTransaction } from '~/utils/etherscan'
import { VESSEL_ADDRESS, VESSEL_ABI, ETHERSCAN_BASE, hexToBytes, renderToCanvas } from '~/utils/vessel'
import { fetchOwnership } from '~/composables/useOwnership'

const router = useRouter()
const wagmiConfig = useConfig()

const searchQuery = ref('')
const activeTab = ref<'activity' | 'holders'>('activity')
const activity = ref<VesselTransaction[]>([])
const feedLoading = ref(true)
const feedError = ref<string | null>(null)
const feedPage = ref(1)
const feedLoadingMore = ref(false)
const feedExhausted = ref(false)
const sentinel = ref<HTMLElement | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)

interface Holder {
  address: string
  count: number
  machines: number
  vaults: number
  capsules: number
  typesLoaded: boolean
}
const holders = ref<Holder[]>([])
const holdersLoading = ref(false)
const holdersLoaded = ref(false)

// ownership map for type enrichment
const ownershipMap = ref(new Map<string, string>())

watch(activeTab, async (tab) => {
  if (tab === 'holders' && !holdersLoaded.value) {
    holdersLoading.value = true
    try {
      const { ownership, ownerTokens } = await fetchOwnership()
      ownershipMap.value = ownership

      // Build holder list immediately (sorted by count)
      holders.value = [...ownerTokens.entries()]
        .map(([address, tokens]) => ({
          address,
          count: tokens.length,
          machines: 0,
          vaults: 0,
          capsules: 0,
          typesLoaded: false,
        }))
        .sort((a, b) => b.count - a.count)

      holdersLoaded.value = true
      holdersLoading.value = false

      // Background: progressively enrich types per holder
      for (let hi = 0; hi < holders.value.length; hi++) {
        const h = holders.value[hi]
        const tokens = ownerTokens.get(h.address) || []
        let machines = 0, vaults = 0, capsules = 0

        for (const tokenId of tokens) {
          try {
            const typeStr = await readContract(wagmiConfig, {
              address: VESSEL_ADDRESS,
              abi: VESSEL_ABI,
              functionName: 'craftToType',
              args: [BigInt(tokenId)],
            }) as string

            const t = typeStr.toLowerCase()
            if (t === 'machine') machines++
            else if (t === 'vault') vaults++
            else capsules++
          } catch {
            // skip
          }
        }

        holders.value[hi] = { ...h, machines, vaults, capsules, typesLoaded: true }
      }
    } catch {
      holdersLoading.value = false
    }
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

  for (const tx of activity.value) {
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
  vesselId: null as string | null,
})

// Cache fetched payloads
const payloadCache = new Map<string, Uint8Array>()

function goToVessel() {
  const q = searchQuery.value.trim()
  if (!q) return
  if ((q.startsWith('0x') && q.length === 42) || q.includes('.eth')) {
    router.push(`/address/${q}`)
  } else {
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

async function showPreview(vesselId: string, event: MouseEvent) {
  const rect = (event.target as HTMLElement).getBoundingClientRect()
  preview.x = rect.left
  preview.y = rect.bottom + 8
  preview.vesselId = vesselId
  preview.visible = true
  preview.loading = true

  let payload = payloadCache.get(vesselId)
  if (!payload) {
    try {
      const raw = await readContract(wagmiConfig, {
        address: VESSEL_ADDRESS,
        abi: VESSEL_ABI,
        functionName: 'craftToPayload',
        args: [BigInt(vesselId)],
      }) as string
      const bytes = hexToBytes(raw)
      if (bytes.length > 0) {
        payload = bytes
        payloadCache.set(vesselId, payload)
      }
    } catch {}
  }

  // Still hovering the same vessel?
  if (preview.vesselId !== vesselId) return
  preview.loading = false

  if (payload?.length) {
    await nextTick()
    renderPreview(payload, Number(vesselId))
  }
}

function hidePreview() {
  preview.visible = false
  preview.vesselId = null
}

function renderPreview(data: Uint8Array, tokenId: number) {
  const canvas = previewCanvas.value
  if (!canvas) return
  renderToCanvas(canvas, data, tokenId, 80)
}

const showActions = new Set(['claim', 'transfer', 'write', 'machine', 'delegate', 'role', 'entry'])

async function loadPage(page: number) {
  const all = await fetchVesselActivity(page)
  const filtered = all.filter(tx => tx.vesselId !== null && tx.isError !== '1' && showActions.has(tx.action))
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

  onUnmounted(() => observer.disconnect())
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

.feed-date-separator {
  color: var(--text-faint);
  font-size: 11px;
  text-transform: lowercase;
  padding: 0.6rem 0 0.25rem;
  letter-spacing: 0.05em;
}

.feed-row {
  display: grid;
  grid-template-columns: 5.5rem 4.5rem 1fr 5rem;
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

.col-time {
  color: var(--text-faint);
  text-align: right;
}

.vessel-id-cell {
  position: relative;
}

.action-badge {
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
.action-role { color: #f472b6; background: rgba(244, 114, 182, 0.2); }
.action-entry { color: var(--color-vault); background: rgba(74, 222, 128, 0.2); }

.vessel-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 700;

  &:hover {
    text-decoration: underline;
  }
}

.etherscan-link {
  color: var(--text-faint);
  text-decoration: none;

  &:hover {
    color: var(--color);
  }
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

.preview-loading {
  color: var(--text-faint);
  font-size: 11px;
  padding: 0.5rem;
}

@media (max-width: 640px) {
  .feed-row {
    grid-template-columns: 5rem 3.5rem 1fr 4rem;
    font-size: 12px;
  }
}
</style>
