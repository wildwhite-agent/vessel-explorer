<template>
  <div class="sequences-page">
    <AppHeader />

    <main class="sequences-content">
      <div class="nav-bar">
        <NuxtLink to="/" class="back-link">[home]</NuxtLink>
      </div>

      <div class="sequences-header">
        <h1 class="sequences-title">sequences</h1>
        <div class="sequences-summary">
          <span v-if="tokens.length">{{ tokens.length }} tokens</span>
          <span v-if="totalMinted"> · {{ formatInteger(totalMinted) }} minted</span>
        </div>
      </div>

      <div v-if="loading" class="status">loading sequences...</div>
      <div v-else-if="error" class="status status-error">{{ error }}</div>
      <div v-else-if="tokens.length === 0" class="status">no sequences found</div>

      <div v-else class="sequence-grid">
        <NuxtLink
          v-for="token in tokens"
          :key="token.tokenId"
          :to="`/sequences/${token.tokenId}`"
          class="sequence-card"
        >
          <div class="sequence-card-top">
            <span class="sequence-id">Sequence #{{ token.tokenId }}</span>
          </div>
          <div class="sequence-image-wrap">
            <img
              :src="sequenceImageUrl(token)"
              alt=""
              class="sequence-image"
              loading="lazy"
            />
          </div>
          <div class="sequence-meta">
            <div class="sequence-artist">{{ token.artist || 'unknown artist' }}</div>
            <div class="sequence-stats">
              <span>{{ formatInteger(token.minted) }} minted</span>
              <span v-if="holderCounts[token.tokenId] != null"> · {{ holderCounts[token.tokenId] }} holders</span>
            </div>
          </div>
        </NuxtLink>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { SequenceToken } from '~/utils/activity'
import { fetchAllSequenceTokens, fetchSequenceBalancePage } from '~/utils/indexer'

const tokens = ref<SequenceToken[]>([])
const holderCounts = ref<Record<string, number>>({})
const loading = ref(true)
const error = ref<string | null>(null)

const totalMinted = computed(() =>
  tokens.value.reduce((sum, token) => sum + integerValue(token.minted), 0n),
)

onMounted(async () => {
  loading.value = true
  error.value = null

  try {
    tokens.value = await fetchAllSequenceTokens({ pageSize: 250 })
    await loadHolderCounts(tokens.value)
  } catch (err: any) {
    error.value = err?.data?.message || err?.message || 'failed to load sequences'
  } finally {
    loading.value = false
  }
})

async function loadHolderCounts(rows: SequenceToken[]) {
  const entries = await Promise.all(rows.map(async (token) => {
    try {
      const page = await fetchSequenceBalancePage({ tokenId: token.tokenId, limit: 1 })
      return [token.tokenId, page.total] as const
    } catch {
      return [token.tokenId, null] as const
    }
  }))

  holderCounts.value = Object.fromEntries(
    entries
      .filter((entry): entry is readonly [string, number] => entry[1] != null)
      .map(([tokenId, count]) => [tokenId, count]),
  )
}

function sequenceImageUrl(token: SequenceToken) {
  const version = encodeURIComponent([
    token.blockNumber || '0',
    token.updatedAt || '0',
    token.minted || '0',
  ].join('-'))
  return `/api/sequence-og/${token.tokenId}?v=${version}`
}

function integerValue(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return 0n
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

function formatInteger(value: string | bigint | null | undefined) {
  const number = typeof value === 'bigint' ? value : integerValue(value)
  return number.toLocaleString('en-US')
}
</script>

<style scoped>
.sequences-page {
  font-family: var(--font-mono);
  max-width: 960px;
  margin: 0 auto;
}

.sequences-content {
  padding: 1rem;
}

.nav-bar {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
}

.sequences-header {
  margin-bottom: 1rem;
}

.sequences-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 0.25rem;
}

.sequences-summary {
  color: var(--muted);
  font-size: 13px;
}

.sequence-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1rem;
}

.sequence-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 0.65rem;
  min-height: 15rem;
  padding: 0.75rem;
  color: var(--color);
  text-decoration: none;
  border: 1px solid var(--border-color);
  background: var(--bg-subtle);
  overflow: hidden;

  &:hover {
    border-color: #f472b6;
  }
}

.sequence-card-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
}

.sequence-id {
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
}

.sequence-image-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  aspect-ratio: 1;
}

.sequence-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.sequence-meta {
  min-width: 0;
  font-size: 12px;
}

.sequence-artist {
  overflow: hidden;
  color: var(--color);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sequence-stats {
  color: var(--muted);
  line-height: 1.45;
}

@media (max-width: 640px) {
  .sequence-grid {
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    gap: 0.75rem;
  }

  .sequence-card {
    min-height: 13rem;
  }
}
</style>
