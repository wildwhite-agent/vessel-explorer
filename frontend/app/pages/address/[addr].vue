<template>
  <div class="profile-page">
    <AppHeader />

    <div class="profile-content">
      <NuxtLink to="/" class="back-link">&lt;- back</NuxtLink>

      <div v-if="resolving" class="status">resolving address...</div>
      <div v-else-if="resolveError" class="status status-error">{{ resolveError }}</div>

      <template v-else>
        <h1 class="profile-title">
          <template v-if="ensName">{{ ensName }}</template>
          <template v-else>{{ shortenAddress(resolvedAddress) }}</template>
        </h1>
        <div v-if="ensName" class="profile-address">{{ resolvedAddress }}</div>

        <div v-if="loading" class="status">loading vessels...</div>
        <div v-else-if="ownedVessels.length === 0" class="status">no vessels found</div>

        <div v-else class="vessel-grid">
          <NuxtLink
            v-for="v in ownedVessels"
            :key="v.id"
            :to="`/${v.id}`"
            class="vessel-card"
          >
            <div class="card-id">#{{ v.id }}</div>
            <ClientOnly>
              <canvas
                v-if="v.payload?.length"
                ref="canvasRefs"
                :data-vessel-id="v.id"
                class="card-thumb"
              />
            </ClientOnly>
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
import { VESSEL_ADDRESS, VESSEL_ABI, renderPixels, getGridDimensions } from '~/utils/vessel'
import { fetchVesselTransfersForAddress, type TokenTransfer } from '~/utils/etherscan'

const route = useRoute()
const config = useConfig()
const runtimeConfig = useRuntimeConfig()

const addr = computed(() => route.params.addr as string)

const resolvedAddress = ref('')
const ensName = ref<string | null>(null)
const resolving = ref(true)
const resolveError = ref<string | null>(null)
const loading = ref(false)

interface OwnedVessel {
  id: string
  payload: Uint8Array | null
}

const ownedVessels = ref<OwnedVessel[]>([])

function shortenAddress(a: string): string {
  if (a.length <= 12) return a
  return `${a.slice(0, 6)}...${a.slice(-4)}`
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
      // ENS name - resolve to address
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
        // Timeout after 10s
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
    const apiKey = runtimeConfig.public.etherscanKey as string
    const transfers = await fetchVesselTransfersForAddress(address, apiKey)

    // Build ownership map from transfer history
    const ownership = new Map<string, string>()
    // Sort by blockNumber ascending to replay history
    const sorted = [...transfers].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber))
    for (const tx of sorted) {
      ownership.set(tx.tokenID, tx.to.toLowerCase())
    }

    // Filter to tokens currently owned by this address
    const owned = [...ownership.entries()]
      .filter(([, owner]) => owner === address.toLowerCase())
      .map(([id]) => id)

    // Fetch payloads for thumbnails
    const vessels: OwnedVessel[] = await Promise.all(
      owned.map(async (id) => {
        try {
          const payload = await readContract(config, {
            address: VESSEL_ADDRESS,
            abi: VESSEL_ABI,
            functionName: 'craftToPayload',
            args: [BigInt(id)],
          }) as string
          const clean = payload.startsWith('0x') ? payload.slice(2) : payload
          const bytes = new Uint8Array(clean.length / 2)
          for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
          }
          return { id, payload: bytes }
        } catch {
          return { id, payload: null }
        }
      }),
    )

    ownedVessels.value = vessels.sort((a, b) => Number(a.id) - Number(b.id))
  } catch (e: any) {
    // silently fail, show empty
  } finally {
    loading.value = false
  }
}

// Render thumbnails on canvas elements after DOM updates
function renderThumbnails() {
  nextTick(() => {
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.card-thumb')
    canvases.forEach((canvas) => {
      const vesselId = Number(canvas.dataset.vesselId)
      const vessel = ownedVessels.value.find((v) => Number(v.id) === vesselId)
      if (!vessel?.payload?.length) return

      const { cols, rows } = getGridDimensions(vesselId)
      const scale = Math.max(1, Math.floor(100 / Math.max(cols, rows)))
      canvas.width = cols * scale
      canvas.height = rows * scale

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.imageSmoothingEnabled = false
      // Draw pixel data
      const img = ctx.createImageData(cols, rows)
      for (let i = 0; i < cols * rows; i++) {
        const v = i < vessel.payload!.length ? vessel.payload![i]! : 0
        const off = i * 4
        img.data[off] = v
        img.data[off + 1] = v
        img.data[off + 2] = v
        img.data[off + 3] = 255
      }
      // Draw at 1:1 then scale
      const tmp = document.createElement('canvas')
      tmp.width = cols
      tmp.height = rows
      tmp.getContext('2d')!.putImageData(img, 0, 0)
      ctx.drawImage(tmp, 0, 0, cols * scale, rows * scale)
    })
  })
}

watch(addr, async (newAddr) => {
  if (newAddr) {
    await resolveAddr(newAddr)
    if (resolvedAddress.value) {
      await loadVessels(resolvedAddress.value)
      renderThumbnails()
    }
  }
}, { immediate: true })

watch(ownedVessels, () => renderThumbnails())
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
  margin-bottom: 1.5rem;
  word-break: break-all;
}

.vessel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
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

  &:hover {
    border-color: var(--accent);
  }
}

.card-id {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 0.5rem;
  color: var(--accent);
}

.card-thumb {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  max-width: 100%;
  height: auto;
}
</style>
