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
        <div class="feed-row feed-row-header">
          <span class="col-action">action</span>
          <span class="col-id">vessel</span>
          <span class="col-from">from</span>
          <span class="col-time">time</span>
          <span class="col-tx">tx</span>
        </div>
        <div
          v-for="tx in activity"
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
          <span class="col-time">{{ formatTime(tx.timeStamp) }}</span>
          <a
            :href="`https://etherscan.io/tx/${tx.hash}`"
            target="_blank"
            rel="noopener"
            class="col-tx etherscan-link"
          >
            {{ tx.hash.slice(0, 10) }}...
          </a>
        </div>
      </div>
    </div>
    </div>

    <!-- Hover preview tooltip -->
    <div
      v-if="preview.visible"
      class="preview-tooltip"
      :style="{ top: preview.y + 'px', left: preview.x + 'px' }"
    >
      <canvas ref="previewCanvas" class="preview-canvas" />
      <div v-if="preview.loading" class="preview-loading">...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { readContract } from '@wagmi/core'
import { useConfig } from '@wagmi/vue'
import { fetchVesselActivity, fetchVesselTransfersForAddress, type VesselTransaction } from '~/utils/etherscan'
import { VESSEL_ADDRESS, VESSEL_ABI, getGridDimensions } from '~/utils/vessel'

const router = useRouter()
const runtimeConfig = useRuntimeConfig()
const wagmiConfig = useConfig()

const searchQuery = ref('')
const activeTab = ref<'activity' | 'holders'>('activity')
const activity = ref<VesselTransaction[]>([])
const feedLoading = ref(true)
const feedError = ref<string | null>(null)
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
      const res = await fetch('/api/transfers?offset=10000')
      const transfers = await res.json()
      if (!Array.isArray(transfers)) { holdersLoading.value = false; return }

      // Replay transfers to compute current ownership
      const ownership = new Map<string, string>()
      const sorted = [...transfers].sort((a: any, b: any) => Number(a.blockNumber) - Number(b.blockNumber))
      for (const tx of sorted) {
        ownership.set(tx.tokenID, tx.to.toLowerCase())
      }
      ownershipMap.value = ownership

      // Group tokens by owner
      const ownerTokens = new Map<string, string[]>()
      for (const [tokenId, owner] of ownership.entries()) {
        if (!ownerTokens.has(owner)) ownerTokens.set(owner, [])
        ownerTokens.get(owner)!.push(tokenId)
      }

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
      const clean = raw.startsWith('0x') ? raw.slice(2) : raw
      if (clean.length > 0) {
        payload = new Uint8Array(clean.length / 2)
        for (let i = 0; i < payload.length; i++) {
          payload[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
        }
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

  const { cols, rows } = getGridDimensions(tokenId)
  const scale = Math.max(2, Math.floor(80 / Math.max(cols, rows)))
  canvas.width = cols * scale
  canvas.height = rows * scale

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.imageSmoothingEnabled = false
  const tmp = document.createElement('canvas')
  tmp.width = cols
  tmp.height = rows
  const tmpCtx = tmp.getContext('2d')!
  const img = tmpCtx.createImageData(cols, rows)
  for (let i = 0; i < cols * rows; i++) {
    const v = i < data.length ? data[i]! : 0
    const off = i * 4
    img.data[off] = v
    img.data[off + 1] = v
    img.data[off + 2] = v
    img.data[off + 3] = 255
  }
  tmpCtx.putImageData(img, 0, 0)
  ctx.drawImage(tmp, 0, 0, cols * scale, rows * scale)
}

onMounted(async () => {
  try {
    const all = await fetchVesselActivity()
    const showActions = new Set(['claim', 'transfer', 'write', 'machine', 'delegate', 'role', 'entry'])
    activity.value = all.filter(tx => tx.vesselId !== null && tx.isError !== '1' && showActions.has(tx.action))
  } catch (e: any) {
    feedError.value = e?.message || 'failed to fetch activity'
  } finally {
    feedLoading.value = false
  }
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

.holder-row {
  grid-template-columns: 2rem 1fr repeat(4, 3.5rem);
}

.dimmed {
  color: var(--text-faint);
}

.col-rank {
  color: var(--text-faint);
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

.feed-table {
  font-size: 13px;
  overflow-x: auto;
}

.feed-row {
  display: grid;
  grid-template-columns: 6rem 5rem 1fr 5rem 8rem;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--border-color);
  align-items: baseline;
  white-space: nowrap;
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
}

.vessel-id-cell {
  position: relative;
}

.action-badge {
  font-size: 11px;
  font-weight: 700;
  text-transform: lowercase;
}

.action-claim { color: #22d3ee; }
.action-write { color: var(--write, #f59e0b); }
.action-delegate { color: #fb923c; }
.action-machine { color: #a78bfa; }
.action-transfer { color: var(--muted); }
.action-role { color: #fb923c; }
.action-entry { color: var(--write, #f59e0b); }

.vessel-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 700;

  &:hover {
    text-decoration: underline;
  }
}

.etherscan-link {
  color: var(--muted);
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
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  display: block;
}

.preview-loading {
  color: var(--text-faint);
  font-size: 11px;
  padding: 0.5rem;
}

@media (max-width: 640px) {
  .feed-row {
    grid-template-columns: 5rem 4rem 1fr;
    font-size: 12px;
  }

  .col-time,
  .col-tx {
    display: none;
  }
}
</style>
