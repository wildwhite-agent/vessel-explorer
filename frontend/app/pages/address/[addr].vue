<template>
  <div class="profile-page">
    <AppHeader />

    <div class="profile-content">
      <a href="#" class="back-link" @click.prevent="$router.back()">[back]</a>

      <div v-if="resolving" class="status">resolving address...</div>
      <div v-else-if="resolveError" class="status status-error">{{ resolveError }}</div>

      <template v-else>
        <h1 class="profile-title">
          <template v-if="ensName">{{ ensName }}</template>
          <template v-else>{{ shortenAddress(resolvedAddress) }}</template>
        </h1>
        <div v-if="ensName" class="profile-address">{{ resolvedAddress }}</div>

        <div v-if="ownedVessels.length > 0" class="profile-stats">
          <span>{{ ownedVessels.length }} vessels</span>
          <span v-if="stats.machine" class="stat-machine"> · {{ stats.machine }} machines</span>
          <span v-if="stats.vault" class="stat-vault"> · {{ stats.vault }} vaults</span>
          <span v-if="stats.capsule" class="stat-capsule"> · {{ stats.capsule }} capsules</span>
          <span v-if="stats.empty" class="stat-empty"> · {{ stats.empty }} empty</span>
        </div>

        <div v-if="loading && ownedVessels.length === 0" class="status">loading vessels...</div>
        <div v-else-if="!loading && ownedVessels.length === 0" class="status">no vessels found</div>

        <div v-else class="vessel-grid">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { readContract } from '@wagmi/core'
import { useConfig } from '@wagmi/vue'
import { isAddress } from 'viem'
import { VESSEL_ADDRESS, VESSEL_ABI, hexToBytes, shortenAddress, renderToCanvas } from '~/utils/vessel'
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

watch(addr, async (newAddr) => {
  if (newAddr) {
    await resolveAddr(newAddr)
    if (resolvedAddress.value) {
      await loadVessels(resolvedAddress.value)
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

.vessel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 1rem;
  margin-top: 1.5rem;
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
