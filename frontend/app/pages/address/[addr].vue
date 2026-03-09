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
          <template v-if="ensName">{{ ensName }}</template>
          <template v-else>{{ shortenAddress(resolvedAddress) }}</template>
        </h1>
        <div v-if="ensName" class="profile-address" @click="copyAddress" title="click to copy">{{ resolvedAddress }}</div>

        <div v-if="ownedVessels.length > 0" class="profile-stats">
          <span>{{ ownedVessels.length }} {{ ownedVessels.length === 1 ? 'vessel' : 'vessels' }}</span>
          <span v-if="stats.machine" class="stat-machine"> · {{ stats.machine }} {{ stats.machine === 1 ? 'machine' : 'machines' }}</span>
          <span v-if="stats.vault" class="stat-vault"> · {{ stats.vault }} {{ stats.vault === 1 ? 'vault' : 'vaults' }}</span>
          <span v-if="stats.capsule" class="stat-capsule"> · {{ stats.capsule }} {{ stats.capsule === 1 ? 'capsule' : 'capsules' }}</span>
          <span v-if="stats.empty" class="stat-empty"> · {{ stats.empty }} empty</span>
        </div>

        <div v-if="loading && ownedVessels.length === 0" class="status">loading vessels...</div>
        <div v-else-if="!loading && ownedVessels.length === 0 && delegatedVessels.length === 0" class="status">no vessels found</div>

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
                    :ref="(el) => { if (el) renderCanvas(el as HTMLCanvasElement, v) }"
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
                    :ref="(el) => { if (el) renderCanvas(el as HTMLCanvasElement, v) }"
                    class="card-thumb"
                  />
                  <div v-else-if="v.loaded" class="card-empty">empty</div>
                  <div v-else class="card-loading">...</div>
                </ClientOnly>
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
import { readContract } from '@wagmi/core'
import { useConfig } from '@wagmi/vue'
import { isAddress } from 'viem'
import { VESSEL_ADDRESS, VESSEL_ABI, hexToBytes, shortenAddress, renderToCanvas } from '~/utils/vessel'

async function copyAddress() {
  if (resolvedAddress.value) {
    await navigator.clipboard.writeText(resolvedAddress.value)
  }
}
import { fetchOwnership, tokensOwnedBy } from '~/composables/useOwnership'

const route = useRoute()
const config = useConfig()


const addr = computed(() => route.params.addr as string)

const resolvedAddress = ref('')
const ensName = ref<string | null>(null)
const resolving = ref(true)
const resolveError = ref<string | null>(null)
const loading = ref(false)

interface OwnedVessel {
  id: string
  payload: Uint8Array | null
  loaded: boolean
  type: string | null
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
  }
  return counts
})

const ownedVessels = ref<OwnedVessel[]>([])
const delegatedVessels = ref<OwnedVessel[]>([])
const delegateLoading = ref(false)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function renderCanvas(canvas: HTMLCanvasElement, vessel: OwnedVessel) {
  if (!vessel.payload?.length) return
  renderToCanvas(canvas, vessel.payload, Number(vessel.id), 100)
}

async function resolveAddr(identifier: string) {
  resolving.value = true
  resolveError.value = null

  try {
    if (isAddress(identifier)) {
      resolvedAddress.value = identifier
      const { data: ens } = useEns(() => identifier)
      watch(ens, (val) => {
        if (val?.ens) ensName.value = val.ens
      }, { immediate: true })
    } else {
      const { data: ens } = useEns(() => identifier)
      await new Promise<void>((resolve) => {
        const stop = watch(ens, (val) => {
          if (val !== undefined) {
            if (val?.address) {
              resolvedAddress.value = val.address
              ensName.value = val.ens
            } else {
              resolveError.value = `could not resolve ${identifier}`
            }
            stop()
            resolve()
          }
        }, { immediate: true })
        setTimeout(() => { stop(); resolve() }, 10000)
      })
    }
  } catch (e: any) {
    resolveError.value = e?.message || 'failed to resolve address'
  } finally {
    resolving.value = false
  }
}

async function loadVessels(address: string) {
  loading.value = true
  try {
    const { ownership } = await fetchOwnership(address)
    const owned = tokensOwnedBy(ownership, address)

    // Add all vessels immediately with loading state
    ownedVessels.value = owned.map(id => ({ id, payload: null, loaded: false, type: null }))

    // Load payload + type one by one (progressive)
    for (const id of owned) {
      try {
        const [payload, vesselType] = await Promise.all([
          readContract(config, {
            address: VESSEL_ADDRESS,
            abi: VESSEL_ABI,
            functionName: 'craftToPayload',
            args: [BigInt(id)],
          }) as Promise<string>,
          readContract(config, {
            address: VESSEL_ADDRESS,
            abi: VESSEL_ABI,
            functionName: 'craftToType',
            args: [BigInt(id)],
          }) as Promise<string>,
        ])
        const bytes = hexToBytes(payload)
        const idx = ownedVessels.value.findIndex(v => v.id === id)
        if (idx !== -1) {
          ownedVessels.value[idx] = { id, payload: bytes.length > 0 ? bytes : null, loaded: true, type: vesselType }
        }
      } catch {
        const idx = ownedVessels.value.findIndex(v => v.id === id)
        if (idx !== -1) {
          ownedVessels.value[idx] = { id, payload: null, loaded: true, type: null }
        }
      }
    }
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
    // Get all claimed vessel IDs from global ownership
    const { ownership } = await fetchOwnership()
    const allIds = [...ownership.keys()]
    // Exclude vessels already owned by this address
    const ownedSet = new Set(ownedVessels.value.map(v => v.id))
    const candidates = allIds.filter(id => !ownedSet.has(id))

    // Batch-check delegates
    const BATCH = 20
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH)
      const delegates = await Promise.all(
        batch.map(id =>
          readContract(config, {
            address: VESSEL_ADDRESS,
            abi: VESSEL_ABI,
            functionName: 'craftToDelegate',
            args: [BigInt(id)],
          }).catch(() => ZERO_ADDRESS) as Promise<string>
        )
      )

      const matched: string[] = []
      for (let j = 0; j < batch.length; j++) {
        if (delegates[j].toLowerCase() === address.toLowerCase()) {
          matched.push(batch[j])
        }
      }

      if (matched.length > 0) {
        // Add matched vessels with loading state
        delegatedVessels.value = [
          ...delegatedVessels.value,
          ...matched.map(id => ({ id, payload: null, loaded: false, type: null })),
        ]

        // Load payload + type for matched vessels
        for (const id of matched) {
          try {
            const [payload, vesselType] = await Promise.all([
              readContract(config, {
                address: VESSEL_ADDRESS,
                abi: VESSEL_ABI,
                functionName: 'craftToPayload',
                args: [BigInt(id)],
              }) as Promise<string>,
              readContract(config, {
                address: VESSEL_ADDRESS,
                abi: VESSEL_ABI,
                functionName: 'craftToType',
                args: [BigInt(id)],
              }) as Promise<string>,
            ])
            const bytes = hexToBytes(payload)
            const idx = delegatedVessels.value.findIndex(v => v.id === id)
            if (idx !== -1) {
              delegatedVessels.value[idx] = { id, payload: bytes.length > 0 ? bytes : null, loaded: true, type: vesselType }
            }
          } catch {
            const idx = delegatedVessels.value.findIndex(v => v.id === id)
            if (idx !== -1) {
              delegatedVessels.value[idx] = { id, payload: null, loaded: true, type: null }
            }
          }
        }
      }
    }
  } catch {
    // silently fail
  } finally {
    delegateLoading.value = false
  }
}

watch(addr, async (newAddr) => {
  if (newAddr) {
    await resolveAddr(newAddr)
    if (resolvedAddress.value) {
      await loadVessels(resolvedAddress.value)
      loadDelegatedVessels(resolvedAddress.value)
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
