<template>
  <div class="sequence-page">
    <AppHeader />

    <main class="sequence-content">
      <div class="nav-bar">
        <a href="#" class="back-link" @click.prevent="$router.back()">[back]</a>
        <NuxtLink to="/sequences" class="text-btn">[all sequences]</NuxtLink>
      </div>

      <div v-if="loading" class="status">loading sequence #{{ id }}...</div>
      <div v-else-if="error" class="status status-error">{{ error }}</div>

      <Transition name="sequence-in">
      <div v-if="sequence" :key="sequence.tokenId" class="sequence-loaded">
        <section class="sequence-hero">
          <div class="sequence-art-wrap">
            <img
              :src="sequenceImageUrl(sequence)"
              alt=""
              class="sequence-art"
            />
          </div>

          <div class="sequence-header">
            <h1 class="sequence-title">
              Sequence #{{ sequence.tokenId }}
              <span :class="['sequence-lock', { locked: sequence.locked }]">
                [{{ sequence.locked ? 'locked' : 'open' }}]
              </span>
            </h1>

            <div class="sequence-meta">
              <div class="meta-row">
                <span class="meta-label">artist</span>
                <span class="meta-value">{{ sequence.artist || 'unknown' }}</span>
              </div>
              <div v-if="sequence.artistAddress" class="meta-row">
                <span class="meta-label">artist address</span>
                <span class="meta-value"><AddressDisplay :address="sequence.artistAddress" /></span>
              </div>
              <div class="meta-row">
                <span class="meta-label">minted</span>
                <span class="meta-value">{{ formatInteger(sequence.minted) }} / {{ formatInteger(sequence.maxSupply) }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">holders</span>
                <span class="meta-value">{{ holderTotal }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">price</span>
                <span class="meta-value">{{ formatInteger(sequence.price) }} VWU</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">event range</span>
                <span class="meta-value">{{ sequence.eventNumStart }} -> {{ sequence.eventNumEnd }}</span>
              </div>
              <div v-if="sequence.renderer" class="meta-row">
                <span class="meta-label">renderer</span>
                <span class="meta-value"><AddressDisplay :address="sequence.renderer" external /></span>
              </div>
              <div class="meta-row">
                <span class="meta-label">metadata</span>
                <span class="meta-value">{{ sequence.usesRenderer ? 'renderer' : 'uri' }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">updated</span>
                <span class="meta-value">{{ updatedLabel }}</span>
              </div>
            </div>
          </div>
        </section>

        <section class="sequence-section">
          <div class="section-header">
            <span>holders</span>
            <span class="section-count">{{ holderTotal }}</span>
          </div>

          <div v-if="holdersLoading" class="status">loading holders...</div>
          <div v-else-if="holdersError" class="status status-error">{{ holdersError }}</div>
          <div v-else-if="holders.length === 0" class="status">no holders</div>
          <div v-else class="holder-table">
            <div class="holder-row holder-header">
              <span class="holder-rank">#</span>
              <span class="holder-address">address</span>
              <span class="holder-balance">balance</span>
            </div>
            <div
              v-for="(holder, index) in holders"
              :key="holder.address"
              class="holder-row"
            >
              <span class="holder-rank">{{ index + 1 }}</span>
              <span class="holder-address"><AddressDisplay :address="holder.address" /></span>
              <span class="holder-balance">x{{ formatInteger(holder.balance) }}</span>
            </div>
          </div>
        </section>

        <section class="sequence-section">
          <div class="section-header">
            <span>history</span>
            <span class="section-count">{{ transfers.length }}</span>
          </div>

          <div v-if="transfersLoading" class="status">loading history...</div>
          <div v-else-if="transfersError" class="status status-error">{{ transfersError }}</div>
          <div v-else-if="transfers.length === 0" class="status">no indexed transfers</div>
          <div v-else class="history-list">
            <article
              v-for="transfer in transfers"
              :key="transferKey(transfer)"
              :class="['history-row', `history-${transferKind(transfer)}`]"
            >
              <div class="history-accent" aria-hidden="true" />
              <div class="history-content">
                <div class="history-topline">
                  <span class="history-kind">{{ transferKind(transfer) }}</span>
                  <span class="history-value">x{{ formatInteger(transfer.value) }}</span>
                  <span class="history-time">{{ formatTime(transfer.timeStamp) }}</span>
                </div>

                <div class="history-meta-grid">
                  <span class="history-meta-item">
                    <span class="history-label">from</span>
                    <AddressDisplay :address="transfer.from" />
                  </span>
                  <span class="history-meta-item">
                    <span class="history-label">to</span>
                    <AddressDisplay :address="transfer.to" />
                  </span>
                  <a
                    :href="`${EXPLORER_BASE}/tx/${transfer.hash}`"
                    target="_blank"
                    rel="noopener"
                    class="history-meta-item explorer-link"
                  >
                    <span class="history-label">tx</span>
                    {{ shortHash(transfer.hash) }}
                  </a>
                  <span class="history-meta-item">
                    <span class="history-label">block</span>
                    {{ transfer.blockNumber }}
                  </span>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
      </Transition>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { SequenceToken } from '~/utils/activity'
import {
  fetchSequenceBalancePage,
  fetchSequenceToken,
  fetchSequenceTransfersForToken,
  type SequenceBalance,
  type SequenceTransfer,
} from '~/utils/indexer'
import { EXPLORER_BASE } from '~/utils/vessel'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const route = useRoute()

const id = computed(() => String(route.params.id || ''))
const sequence = ref<SequenceToken | null>(null)
const holders = ref<SequenceBalance[]>([])
const transfers = ref<SequenceTransfer[]>([])
const holderTotal = ref(0)
const loading = ref(true)
const holdersLoading = ref(false)
const transfersLoading = ref(false)
const error = ref<string | null>(null)
const holdersError = ref<string | null>(null)
const transfersError = ref<string | null>(null)
let requestId = 0

const updatedLabel = computed(() => {
  if (!sequence.value) return ''
  const parts: string[] = []
  if (sequence.value.updatedAt) parts.push(formatTime(sequence.value.updatedAt))
  if (sequence.value.blockNumber) parts.push(`block ${sequence.value.blockNumber}`)
  return parts.join(' · ') || 'unknown'
})

watch(id, (nextId) => {
  void loadSequence(nextId)
}, { immediate: true })

async function loadSequence(sequenceId: string) {
  const currentRequest = ++requestId
  sequence.value = null
  holders.value = []
  transfers.value = []
  holderTotal.value = 0
  error.value = null
  holdersError.value = null
  transfersError.value = null

  if (!/^\d+$/.test(sequenceId)) {
    loading.value = false
    error.value = 'invalid sequence id'
    return
  }

  loading.value = true
  try {
    const token = await fetchSequenceToken(sequenceId)
    if (currentRequest !== requestId) return
    if (!token) {
      error.value = 'sequence not found'
      return
    }

    sequence.value = token
    void loadHolders(sequenceId, currentRequest)
    void loadTransfers(sequenceId, currentRequest)
  } catch (err: any) {
    if (currentRequest !== requestId) return
    const status = err?.statusCode || err?.response?.status
    error.value = status === 404
      ? 'sequence not found'
      : err?.data?.message || err?.message || 'failed to load sequence'
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

async function loadHolders(sequenceId: string, currentRequest: number) {
  holdersLoading.value = true
  holdersError.value = null

  try {
    const page = await fetchSequenceBalancePage({
      tokenId: sequenceId,
      includeToken: 'true',
      limit: 250,
    })
    if (currentRequest !== requestId) return
    holders.value = page.rows
    holderTotal.value = page.total
  } catch (err: any) {
    if (currentRequest !== requestId) return
    holders.value = []
    holderTotal.value = 0
    holdersError.value = err?.data?.message || err?.message || 'failed to load holders'
  } finally {
    if (currentRequest === requestId) holdersLoading.value = false
  }
}

async function loadTransfers(sequenceId: string, currentRequest: number) {
  transfersLoading.value = true
  transfersError.value = null

  try {
    const rows = await fetchSequenceTransfersForToken(sequenceId, 100)
    if (currentRequest !== requestId) return
    transfers.value = rows
  } catch (err: any) {
    if (currentRequest !== requestId) return
    transfers.value = []
    transfersError.value = err?.data?.message || err?.message || 'failed to load history'
  } finally {
    if (currentRequest === requestId) transfersLoading.value = false
  }
}

function sequenceImageUrl(token: SequenceToken) {
  const version = encodeURIComponent([
    token.blockNumber || '0',
    token.updatedAt || '0',
    token.minted || '0',
  ].join('-'))
  return `/api/sequence-og/${token.tokenId}?v=${version}`
}

function transferKey(transfer: SequenceTransfer) {
  return `${transfer.hash}-${transfer.logIndex}-${transfer.batchIndex}`
}

function transferKind(transfer: SequenceTransfer) {
  const from = transfer.from.toLowerCase()
  const to = transfer.to.toLowerCase()
  if (from === ZERO_ADDRESS && to !== ZERO_ADDRESS) return 'mint'
  if (to === ZERO_ADDRESS && from !== ZERO_ADDRESS) return 'burn'
  return 'transfer'
}

function formatTime(ts: string | null | undefined) {
  if (!ts) return 'unknown time'
  const date = new Date(Number(ts) * 1000)
  if (Number.isNaN(date.getTime())) return 'unknown time'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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

function shortHash(hash: string) {
  if (!hash) return ''
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`
}
</script>

<style scoped>
.sequence-page {
  font-family: var(--font-mono);
  max-width: 960px;
  margin: 0 auto;
}

.sequence-content {
  padding: 1rem;
}

.nav-bar {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
}

.sequence-hero {
  display: grid;
  grid-template-columns: minmax(220px, 360px) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
  margin-bottom: 1.5rem;
}

.sequence-art-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border: 1px solid var(--border-color);
  background: var(--bg-subtle);
  overflow: hidden;
}

.sequence-art {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.sequence-title {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: baseline;
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 1rem;
}

.sequence-lock {
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;

  &.locked {
    color: var(--error);
  }
}

.sequence-meta {
  font-size: 13px;
}

.meta-row {
  display: flex;
  gap: 1rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--border-color);
}

.meta-label {
  width: 7rem;
  flex-shrink: 0;
  color: var(--muted);
}

.meta-value {
  min-width: 0;
  overflow: hidden;
  color: var(--color);
  text-overflow: ellipsis;
}

.sequence-section {
  margin-top: 1.5rem;
  font-size: 13px;
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

.holder-table,
.history-list {
  border: 1px solid var(--border-color);
  border-top: 0;
}

.holder-row {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr) 6rem;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--border-color);

  &:last-child {
    border-bottom: 0;
  }
}

.holder-header {
  color: var(--muted);
  background: var(--background);
  font-size: 12px;
  text-transform: uppercase;
}

.holder-rank {
  color: var(--text-faint);
}

.holder-address {
  min-width: 0;
  overflow: hidden;
}

.holder-balance {
  color: var(--color);
  text-align: right;
}

.history-row {
  display: grid;
  grid-template-columns: 0.25rem minmax(0, 1fr);
  border-bottom: 1px solid var(--border-color);
  background: var(--background);

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: var(--bg-subtle);
  }
}

.history-accent {
  background: #f472b6;
}

.history-transfer .history-accent {
  background: var(--muted);
}

.history-burn .history-accent {
  background: var(--error);
}

.history-content {
  min-width: 0;
  padding: 0.7rem 0.75rem 0.75rem;
}

.history-topline {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.45rem;
}

.history-kind {
  color: #f472b6;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.history-value {
  color: var(--color);
  font-weight: 700;
}

.history-time {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
  text-align: right;
}

.history-meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}

.history-meta-item {
  min-width: 0;
  color: var(--muted);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-label {
  display: block;
  color: var(--text-faint);
  font-size: 10px;
  line-height: 1.4;
  text-transform: uppercase;
}

.explorer-link:hover {
  color: var(--color);
  text-decoration: underline;
}

.sequence-in-enter-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}

.sequence-in-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 760px) {
  .sequence-hero {
    grid-template-columns: 1fr;
  }

  .sequence-art-wrap {
    max-width: 420px;
    width: 100%;
  }

  .history-meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .holder-row {
    grid-template-columns: 2rem minmax(0, 1fr) 4.5rem;
    gap: 0.5rem;
    padding: 0.5rem;
  }

  .meta-row {
    gap: 0.5rem;
  }

  .meta-label {
    width: 6rem;
  }

  .history-topline {
    flex-wrap: wrap;
  }

  .history-time {
    margin-left: 0;
    width: 100%;
    text-align: left;
  }
}
</style>
