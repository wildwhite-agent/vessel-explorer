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
      </form>
    </div>

    <div class="feed-section">
      <div class="feed-header">recent vessel activity</div>

      <div v-if="feedLoading" class="feed-status">loading transfers...</div>
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
          :class="{ 'feed-row-error': tx.isError === '1' }"
        >
          <span class="col-action">
            <span class="action-badge" :class="`action-${tx.action}`">{{ tx.action }}</span>
          </span>
          <span class="col-id">
            <NuxtLink v-if="tx.vesselId" :to="`/${tx.vesselId}`" class="vessel-link">
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
</template>

<script setup lang="ts">
import { fetchVesselActivity, type VesselTransaction } from '~/utils/etherscan'

const router = useRouter()
const config = useRuntimeConfig()

const searchQuery = ref('')
const activity = ref<VesselTransaction[]>([])
const feedLoading = ref(true)
const feedError = ref<string | null>(null)

function goToVessel() {
  const q = searchQuery.value.trim()
  if (!q) return
  // If it looks like an address (0x...) or ENS name (.eth), go to profile
  if (q.startsWith('0x') && q.length === 42 || q.includes('.eth')) {
    router.push(`/address/${q}`)
  } else {
    router.push(`/${q}`)
  }
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

onMounted(async () => {
  try {
    const apiKey = config.public.etherscanKey as string
    const all = await fetchVesselActivity(apiKey)
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
  max-width: 400px;
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

/* Hide number input spinners */
.search-input::-webkit-outer-spin-button,
.search-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.search-input[type='number'] {
  -moz-appearance: textfield;
}

.feed-section {
  padding: 1rem;
}

.feed-header {
  font-size: 13px;
  color: var(--muted);
  text-transform: lowercase;
  margin-bottom: 0.75rem;
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

.feed-row-error {
  opacity: 0.4;
}

.col-from {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
}

.col-time {
  color: var(--text-faint);
}

.action-badge {
  font-size: 11px;
  font-weight: 700;
  text-transform: lowercase;
}

.action-claim { color: var(--accent); }
.action-write { color: var(--write, #f59e0b); }
.action-delegate { color: #a78bfa; }
.action-machine { color: #22d3ee; }
.action-transfer { color: var(--muted); }
.action-role { color: #fb923c; }
.action-entry { color: #a78bfa; }
.action-refresh { color: #34d399; }

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
