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
          </div>
        </NuxtLink>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { SequenceToken } from '~/utils/activity'
import { fetchAllSequenceTokens } from '~/utils/indexer'

const tokens = ref<SequenceToken[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  loading.value = true
  error.value = null

  try {
    tokens.value = await fetchAllSequenceTokens({ pageSize: 250 })
  } catch (err: any) {
    error.value = err?.data?.message || err?.message || 'failed to load sequences'
  } finally {
    loading.value = false
  }
})

function sequenceImageUrl(token: SequenceToken) {
  const version = encodeURIComponent([
    token.blockNumber || '0',
    token.updatedAt || '0',
    token.minted || '0',
  ].join('-'))
  return `/api/sequence-og/${token.tokenId}?v=${version}`
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
