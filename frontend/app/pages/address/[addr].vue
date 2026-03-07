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
          <span v-if="stats.machine"> · {{ stats.machine }} machines</span>
          <span v-if="stats.vault"> · {{ stats.vault }} vaults</span>
          <span v-if="stats.capsule"> · {{ stats.capsule }} capsules</span>
        </div>

        <div v-if="loading && ownedVessels.length === 0" class="status">loading vessels...</div>
        <div v-else-if="!loading && ownedVessels.length === 0" class="status">no vessels found</div>

        <div v-else class="vessel-grid">
          <NuxtLink
            v-for="v in ownedVessels"
            :key="v.id"
            :to="`/${v.id}`"
            class="vessel-card"
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
import { VESSEL_ADDRESS, VESSEL_ABI, getGridDimensions } from '~/utils/vessel'
import { fetchVesselTransfersForAddress } from '~/utils/etherscan'

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
  }
  return counts
})

const ownedVessels = ref<OwnedVessel[]>([])

function shortenAddress(a: string): string {
  if (a.length <= 12) return a
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}

function renderCanvas(canvas: HTMLCanvasElement, vessel: OwnedVessel) {
  if (!vessel.payload?.length) return
  const vesselId = Number(vessel.id)
  const { cols, rows } = getGridDimensions(vesselId)
  const scale = Math.max(1, Math.floor(100 / Math.max(cols, rows)))
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
    const v = i < vessel.payload!.length ? vessel.payload![i]! : 0
    const off = i * 4
    img.data[off] = v
    img.data[off + 1] = v
    img.data[off + 2] = v
    img.data[off + 3] = 255
  }
  tmpCtx.putImageData(img, 0, 0)
  ctx.drawImage(tmp, 0, 0, cols * scale, rows * scale)
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
    const transfers = await fetchVesselTransfersForAddress(address)

    const ownership = new Map<string, string>()
    const sorted = [...transfers].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber))
    for (const tx of sorted) {
      ownership.set(tx.tokenID, tx.to.toLowerCase())
    }

    const owned = [...ownership.entries()]
      .filter(([, owner]) => owner === address.toLowerCase())
      .map(([id]) => id)
      .sort((a, b) => Number(a) - Number(b))

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
        const clean = payload.startsWith('0x') ? payload.slice(2) : payload
        const bytes = new Uint8Array(clean.length / 2)
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
        }
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

.back-link {
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
  display: inline-block;
  margin-bottom: 1rem;

  &:hover {
    color: var(--color);
  }
}

.status {
  color: var(--muted);
  font-size: 13px;
  padding: 1rem 0;
}

.status-error {
  color: var(--error);
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
    border-color: var(--accent);
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
