<template>
  <div class="profile-page">
    <AppHeader />

    <div class="profile-content">
      <a href="#" class="back-link" @click.prevent="$router.back()">[back]</a>

      <div v-if="resolving" class="status">resolving address...</div>
      <div v-else-if="resolveError" class="status status-error">{{ resolveError }}</div>

      <Transition name="vessel-in">
      <div v-if="!resolving && !resolveError" :key="resolvedAddress" class="profile-loaded">
        <h1 class="profile-title">
          <AddressDisplay :address="resolvedAddress" :link="false" />
        </h1>
        <div class="profile-address" @click="copyAddress" title="click to copy">{{ resolvedAddress }}</div>

        <div v-if="ownedVessels.length > 0 || sequences.length > 0" class="profile-stats">
          <span v-if="ownedVessels.length > 0">{{ ownedVessels.length }} {{ ownedVessels.length === 1 ? 'vessel' : 'vessels' }}</span>
          <span v-if="stats.axiom" class="stat-axiom"> · {{ stats.axiom }} {{ stats.axiom === 1 ? 'axiom' : 'axioms' }}</span>
          <span v-if="stats.relic" class="stat-relic"> · {{ stats.relic }} {{ stats.relic === 1 ? 'relic' : 'relics' }}</span>
          <span v-if="stats.machine" class="stat-machine"> · {{ stats.machine }} {{ stats.machine === 1 ? 'machine' : 'machines' }}</span>
          <span v-if="stats.vault" class="stat-vault"> · {{ stats.vault }} {{ stats.vault === 1 ? 'vault' : 'vaults' }}</span>
          <span v-if="stats.capsule" class="stat-capsule"> · {{ stats.capsule }} {{ stats.capsule === 1 ? 'capsule' : 'capsules' }}</span>
          <span v-if="stats.empty" class="stat-empty"> · {{ stats.empty }} empty</span>
          <span v-if="sequences.length > 0" class="stat-sequence">{{ ownedVessels.length > 0 ? ' · ' : '' }}{{ sequences.length }} {{ sequences.length === 1 ? 'sequence' : 'sequences' }}</span>
        </div>

        <div v-if="loading && ownedVessels.length === 0" class="status">loading vessels...</div>
        <div
          v-else-if="!loading && !delegateLoading && !sequenceLoading && ownedVessels.length === 0 && delegatedVessels.length === 0 && sequences.length === 0"
          class="status"
        >
          no vessels or sequences found
        </div>

        <template v-if="ownedVessels.length > 0">
          <h2 class="section-title">owned</h2>
          <div class="vessel-grid">
            <NuxtLink
              v-for="v in ownedVessels"
              :key="v.id"
              :to="`/${v.id}`"
              :class="['vessel-card', v.type ? `card-${v.type.toLowerCase()}` : '']"
            >
              <div class="card-id">#{{ v.id }}</div>
              <div class="card-thumb-wrap">
                <ClientOnly>
                  <canvas
                    v-if="v.payload?.length"
                    :ref="vesselCanvasRef(v)"
                    class="card-thumb"
                  />
                  <div v-else-if="v.loaded" class="card-empty">empty</div>
                  <div v-else class="card-loading">...</div>
                </ClientOnly>
              </div>
            </NuxtLink>
          </div>
        </template>

        <template v-if="delegatedVessels.length > 0 || delegateLoading">
          <h2 class="section-title">delegated</h2>
          <div v-if="delegateLoading && delegatedVessels.length === 0" class="status">scanning delegates...</div>
          <div v-else class="vessel-grid">
            <NuxtLink
              v-for="v in delegatedVessels"
              :key="v.id"
              :to="`/${v.id}`"
              :class="['vessel-card', v.type ? `card-${v.type.toLowerCase()}` : '']"
            >
              <div class="card-id">#{{ v.id }}</div>
              <div class="card-thumb-wrap">
                <ClientOnly>
                  <canvas
                    v-if="v.payload?.length"
                    :ref="vesselCanvasRef(v)"
                    class="card-thumb"
                  />
                  <div v-else-if="v.loaded" class="card-empty">empty</div>
                  <div v-else class="card-loading">...</div>
                </ClientOnly>
              </div>
            </NuxtLink>
          </div>
        </template>

        <template v-if="sequences.length > 0 || sequenceLoading">
          <h2 class="section-title">sequences</h2>
          <div v-if="sequenceLoading && sequences.length === 0" class="status">loading sequences...</div>
          <div v-else class="vessel-grid">
            <NuxtLink
              v-for="sequence in sequences"
              :key="sequence.tokenId"
              :to="`/sequences/${sequence.tokenId}`"
              class="vessel-card sequence-card"
            >
              <div class="card-id">#{{ sequence.tokenId }}</div>
              <div class="card-thumb-wrap sequence-thumb-wrap">
                <img
                  :src="sequence.imageUrl"
                  alt=""
                  class="sequence-thumb"
                  loading="lazy"
                />
              </div>
            </NuxtLink>
          </div>
        </template>
      </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { renderToCanvas, type ColorMode } from '~/utils/vessel'
import { bytesFromHex, fetchAllTokenRows, fetchSequenceBalancesForAddress, type SequenceBalance, type TokenRow } from '~/utils/indexer'
import { resolveEnsName } from '~/utils/ens'
import { parseVesselSearchQuery } from '~/utils/search'

async function copyAddress() {
  if (resolvedAddress.value) {
    await navigator.clipboard.writeText(resolvedAddress.value)
  }
}
const route = useRoute()

const addr = computed(() => route.params.addr as string)

const resolvedAddress = ref('')
const resolving = ref(true)
const resolveError = ref<string | null>(null)
const loading = ref(false)

interface OwnedVessel {
  id: string
  payload: Uint8Array | null
  loaded: boolean
  type: string | null
  colorMode: ColorMode
  axiom: boolean
  relic: boolean
}

const stats = computed(() => {
  const counts: Record<string, number> = {}
  for (const v of ownedVessels.value) {
    if (v.type) {
      const t = v.type.toLowerCase()
      counts[t] = (counts[t] || 0) + 1
    }
    if (v.loaded && (!v.payload || v.payload.length === 0)) {
      counts.empty = (counts.empty || 0) + 1
    }
    if (v.axiom) counts.axiom = (counts.axiom || 0) + 1
    if (v.relic) counts.relic = (counts.relic || 0) + 1
  }
  return counts
})

const ownedVessels = ref<OwnedVessel[]>([])
const delegatedVessels = ref<OwnedVessel[]>([])
const sequences = ref<OwnedSequence[]>([])
const delegateLoading = ref(false)
const sequenceLoading = ref(false)

interface OwnedSequence {
  tokenId: string
  balance: string
  imageUrl: string
}

function renderCanvas(canvas: HTMLCanvasElement, vessel: OwnedVessel) {
  if (!vessel.payload?.length) return
  renderToCanvas(canvas, vessel.payload, Number(vessel.id), 100, vessel.colorMode)
}

function vesselCanvasRef(vessel: OwnedVessel) {
  return (el: Element | ComponentPublicInstance | null) => {
    if (el instanceof HTMLCanvasElement) renderCanvas(el, vessel)
  }
}

async function resolveAddr(identifier: string) {
  resolving.value = true
  resolveError.value = null
  resolvedAddress.value = ''
  const parsed = parseVesselSearchQuery(identifier)

  try {
    if (parsed.kind === 'address') {
      resolvedAddress.value = parsed.value
    } else if (parsed.kind === 'ens') {
      const resolution = await resolveEnsName(parsed.value)
      resolvedAddress.value = resolution.address
    } else {
      resolveError.value = `invalid address ${parsed.value || identifier}`
    }
  } catch (e: any) {
    resolveError.value = e?.data?.message || e?.message || 'failed to resolve address'
  } finally {
    resolving.value = false
  }
}

function rowToVessel(row: TokenRow): OwnedVessel {
  const payload = bytesFromHex(row.payloadHex)
  return {
    id: String(row.id),
    payload: payload.length ? payload : null,
    loaded: true,
    type: row.type,
    colorMode: Number(row.colorMode || 0) as ColorMode,
    axiom: Boolean(row.axiom),
    relic: Boolean(row.relic),
  }
}

async function loadVessels(address: string) {
  loading.value = true
  try {
    const rows = await fetchAllTokenRows({
      owner: address,
      includePayload: true,
      sort: 'id',
      dir: 'asc',
      pageSize: 250,
    })
    ownedVessels.value = rows.map(rowToVessel)
  } catch {
    // silently fail
  } finally {
    loading.value = false
  }
}

async function loadDelegatedVessels(address: string) {
  delegateLoading.value = true
  delegatedVessels.value = []

  try {
    const ownedSet = new Set(ownedVessels.value.map(v => v.id))
    const rows = await fetchAllTokenRows({
      delegate: address,
      includePayload: true,
      sort: 'id',
      dir: 'asc',
      pageSize: 250,
    })
    delegatedVessels.value = rows
      .filter(row => !ownedSet.has(String(row.id)))
      .map(rowToVessel)
  } catch {
    // silently fail
  } finally {
    delegateLoading.value = false
  }
}

function rowToSequence(row: SequenceBalance): OwnedSequence {
  return {
    tokenId: row.tokenId,
    balance: row.balance,
    imageUrl: sequenceImageUrl(row),
  }
}

function sequenceImageUrl(row: SequenceBalance) {
  const version = encodeURIComponent([
    row.token?.blockNumber || row.blockNumber || '0',
    row.token?.updatedAt || row.updatedAt || '0',
    row.balance,
  ].join('-'))
  return `/api/sequence-media/${row.tokenId}/image?v=${version}`
}

async function loadSequences(address: string) {
  sequenceLoading.value = true
  sequences.value = []

  try {
    sequences.value = (await fetchSequenceBalancesForAddress(address)).map(rowToSequence)
  } catch {
    // silently fail
  } finally {
    sequenceLoading.value = false
  }
}

watch(addr, async (newAddr) => {
  if (newAddr) {
    await resolveAddr(newAddr)
    if (resolvedAddress.value) {
      await loadVessels(resolvedAddress.value)
      loadDelegatedVessels(resolvedAddress.value)
      loadSequences(resolvedAddress.value)
    }
  }
}, { immediate: true })
</script>

<style scoped>
.profile-page {
  font-family: var(--font-mono);
  max-width: 960px;
  margin: 0 auto;
}

.profile-content {
  padding: 1rem;
}

.profile-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 0.25rem 0;
}

.profile-title :deep(.address-display) {
  color: var(--color);
}

.profile-address {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 0.5rem;
  word-break: break-all;
  cursor: pointer;

  &:hover {
    color: var(--color);
  }
}

.profile-stats {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 1rem;
}

.stat-machine { color: var(--color-machine); }
.stat-vault { color: var(--color-vault); }
.stat-capsule { color: var(--color-capsule); }
.stat-empty { color: var(--text-faint); }
.stat-sequence { color: #f472b6; }

.section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  text-transform: lowercase;
  margin: 1.5rem 0 0 0;
}

.vessel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 1rem;
  margin-top: 0.75rem;
}

.vessel-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-decoration: none;
  color: var(--color);
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  background: var(--bg-subtle);
  aspect-ratio: 1;
  overflow: hidden;

  &:hover {
    border-color: var(--color);
  }

  &.card-machine:hover {
    border-color: var(--color-machine);
  }

  &.card-vault:hover {
    border-color: var(--color-vault);
  }

  &.card-capsule:hover {
    border-color: var(--color-capsule);
  }

  &.sequence-card:hover {
    border-color: #f472b6;
  }
}

.card-id {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 0.5rem;
  color: var(--accent);
  flex-shrink: 0;
}

.card-thumb-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 0;
}

.card-thumb {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.card-empty {
  color: var(--text-faint);
  font-size: 11px;
}

.card-loading {
  color: var(--text-faint);
  font-size: 11px;
}

.sequence-thumb {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.vessel-in-enter-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}

.vessel-in-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 640px) {
  .vessel-grid {
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 0.5rem;
  }

  .profile-title {
    font-size: 16px;
    word-break: break-all;
  }
}
</style>
