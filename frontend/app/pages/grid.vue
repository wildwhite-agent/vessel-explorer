<template>
  <div class="grid-page">
    <AppHeader />

    <div class="grid-toolbar">
      <NuxtLink to="/" class="back-link">[back]</NuxtLink>
      <div class="zoom-controls">
        <button class="text-btn" @click="zoomIn">[+]</button>
        <button class="text-btn" @click="zoomOut">[-]</button>
      </div>
      <span class="grid-info">{{ totalVessels }} vessels</span>
    </div>

    <div
      ref="scrollContainer"
      class="grid-scroll"
      @scroll="onScroll"
      @touchstart="onTouchStart"
      @touchend="onTouchEnd"
    >
      <div
        class="grid-sizer"
        :style="{
          width: gridSide * cellSize + 'px',
          height: gridSide * cellSize + 'px',
        }"
      >
        <div
          class="grid-viewport"
          :style="{
            transform: `translate(${startCol * cellSize}px, ${startRow * cellSize}px)`,
            gridTemplateColumns: `repeat(${visCols}, ${cellSize}px)`,
            gridAutoRows: `${cellSize}px`,
          }"
        >
          <div
            v-for="id in visibleIds"
            :key="id"
            :class="['grid-cell', { claimed: claimedSet.has(id), loaded: payloadCache.has(id) }, typeClass(id)]"
            :title="`#${id}`"
            @click="$router.push(`/${id}`)"
          >
            <canvas
              v-if="payloadCache.has(id)"
              :ref="(el) => { if (el) renderCell(el as HTMLCanvasElement, id) }"
              class="cell-canvas pixelated"
            />
            <span v-else class="cell-id" :style="{ fontSize: Math.max(6, cellSize * 0.15) + 'px' }">{{ id }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { readContract } from '@wagmi/core'
import { useConfig } from '@wagmi/vue'
import { VESSEL_ADDRESS, VESSEL_ABI, hexToBytes, renderToCanvas, type ColorMode } from '~/utils/vessel'
import { fetchOwnership } from '~/composables/useOwnership'

const wagmiConfig = useConfig()

const totalVessels = 10000
const scrollContainer = ref<HTMLElement | null>(null)

// Square grid: 100x100 = 10,000
const gridSide = 100

// Zoom
const cellSize = ref(80)
const ZOOM_MIN = 16
const ZOOM_MAX = 120
const ZOOM_STEP = 8

function zoomIn() {
  cellSize.value = Math.min(ZOOM_MAX, cellSize.value + ZOOM_STEP)
}

function zoomOut() {
  cellSize.value = Math.max(ZOOM_MIN, cellSize.value - ZOOM_STEP)
}

// Virtual scroll — 2D
const scrollTop = ref(0)
const scrollLeft = ref(0)
const viewportWidth = ref(960)
const viewportHeight = ref(800)
const overscan = 3

const startRow = computed(() => Math.max(0, Math.floor(scrollTop.value / cellSize.value) - overscan))
const endRow = computed(() => Math.min(gridSide, Math.ceil((scrollTop.value + viewportHeight.value) / cellSize.value) + overscan))
const startCol = computed(() => Math.max(0, Math.floor(scrollLeft.value / cellSize.value) - overscan))
const endCol = computed(() => Math.min(gridSide, Math.ceil((scrollLeft.value + viewportWidth.value) / cellSize.value) + overscan))

const visCols = computed(() => endCol.value - startCol.value)

const visibleIds = computed(() => {
  const ids: number[] = []
  for (let row = startRow.value; row < endRow.value; row++) {
    for (let col = startCol.value; col < endCol.value; col++) {
      const id = row * gridSide + col + 1
      if (id <= totalVessels) ids.push(id)
    }
  }
  return ids
})

// Viewport IDs (no overscan) — used to prioritize loading
const vpStartRow = computed(() => Math.max(0, Math.floor(scrollTop.value / cellSize.value)))
const vpEndRow = computed(() => Math.min(gridSide, Math.ceil((scrollTop.value + viewportHeight.value) / cellSize.value)))
const vpStartCol = computed(() => Math.max(0, Math.floor(scrollLeft.value / cellSize.value)))
const vpEndCol = computed(() => Math.min(gridSide, Math.ceil((scrollLeft.value + viewportWidth.value) / cellSize.value)))

const prioritizedIds = computed(() => {
  const inView: number[] = []
  const inOverscan: number[] = []
  for (const id of visibleIds.value) {
    const row = Math.floor((id - 1) / gridSide)
    const col = (id - 1) % gridSide
    if (row >= vpStartRow.value && row < vpEndRow.value && col >= vpStartCol.value && col < vpEndCol.value) {
      inView.push(id)
    } else {
      inOverscan.push(id)
    }
  }
  return [...inView, ...inOverscan]
})

// Claimed vessels
const claimedSet = ref(new Set<number>())

// Payload + type + colorMode cache
const payloadCache = reactive(new Map<number, Uint8Array>())
const typeCache = reactive(new Map<number, string>())
const colorModeCache = reactive(new Map<number, ColorMode>())
const loadingSet = new Set<number>()

function typeClass(id: number): string {
  const t = typeCache.get(id)
  if (!t) return ''
  return `cell-${t.toLowerCase()}`
}

function renderCell(canvas: HTMLCanvasElement, id: number) {
  const data = payloadCache.get(id)
  if (!data) return
  renderToCanvas(canvas, data, id, cellSize.value, colorModeCache.get(id) ?? 0)
}

// Loading with cancellation via token
let currentToken = 0

async function loadVisible() {
  const token = ++currentToken
  loadingSet.clear()

  const ids = prioritizedIds.value

  // Load types in batches of 30
  for (let i = 0; i < ids.length && token === currentToken; i += 30) {
    const batch = ids.slice(i, i + 30).filter(id => !typeCache.has(id))
    if (!batch.length) continue
    const results = await Promise.all(
      batch.map(id =>
        readContract(wagmiConfig, {
          address: VESSEL_ADDRESS,
          abi: VESSEL_ABI,
          functionName: 'craftToType',
          args: [BigInt(id)],
        }).catch(() => 'Capsule') as Promise<string>
      )
    )
    if (token !== currentToken) return
    for (let j = 0; j < batch.length; j++) {
      typeCache.set(batch[j]!, results[j]!)
    }
  }

  // Load payloads + colorModes — each renders individually as it arrives
  const claimedIds = ids.filter(id => claimedSet.value.has(id) && !payloadCache.has(id))
  for (let i = 0; i < claimedIds.length && token === currentToken; i += 10) {
    const batch = claimedIds.slice(i, i + 10)
    await Promise.all(
      batch.map(async (id) => {
        if (token !== currentToken) return
        try {
          const [raw, cm] = await Promise.all([
            readContract(wagmiConfig, {
              address: VESSEL_ADDRESS,
              abi: VESSEL_ABI,
              functionName: 'craftToPayload',
              args: [BigInt(id)],
            }) as Promise<string>,
            readContract(wagmiConfig, {
              address: VESSEL_ADDRESS,
              abi: VESSEL_ABI,
              functionName: 'craftToColorMode',
              args: [BigInt(id)],
            }).catch(() => 0) as Promise<number>,
          ])
          colorModeCache.set(id, cm as ColorMode)
          const bytes = hexToBytes(raw)
          if (bytes.length > 0) payloadCache.set(id, bytes)
        } catch { /* skip */ }
      })
    )
  }
}

let scrollTimer: ReturnType<typeof setTimeout> | null = null
let hasMounted = false

watch(visibleIds, () => {
  if (!hasMounted) return
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => loadVisible(), 100)
})

let scrollRaf = 0
function onScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    if (scrollContainer.value) {
      scrollTop.value = scrollContainer.value.scrollTop
      scrollLeft.value = scrollContainer.value.scrollLeft
    }
    scrollRaf = 0
  })
}

// Pinch-to-zoom
let lastPinchDist = 0
let pinching = false

function getTouchDist(e: TouchEvent): number {
  const [a, b] = [e.touches[0]!, e.touches[1]!]
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function getTouchMidpoint(e: TouchEvent): { x: number; y: number } {
  const [a, b] = [e.touches[0]!, e.touches[1]!]
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 2) {
    pinching = true
    lastPinchDist = getTouchDist(e)
  }
}

function onTouchMove(e: TouchEvent) {
  if (!pinching || e.touches.length !== 2) return
  e.preventDefault()
  const el = scrollContainer.value!
  const rect = el.getBoundingClientRect()
  const mid = getTouchMidpoint(e)

  // Midpoint relative to scroll container viewport
  const cx = mid.x - rect.left
  const cy = mid.y - rect.top

  // Position in grid content coordinates
  const gridX = el.scrollLeft + cx
  const gridY = el.scrollTop + cy

  const oldSize = cellSize.value
  const dist = getTouchDist(e)
  const scale = dist / lastPinchDist
  const newSize = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(oldSize * scale)))
  lastPinchDist = dist
  if (newSize === oldSize) return
  cellSize.value = newSize

  // Adjust scroll so midpoint stays under fingers
  const ratio = newSize / oldSize
  el.scrollLeft = gridX * ratio - cx
  el.scrollTop = gridY * ratio - cy
}

function onTouchEnd(e: TouchEvent) {
  if (e.touches.length < 2) pinching = false
}

// Trackpad / ctrl+wheel zoom — centered on cursor
function onWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const el = scrollContainer.value!
  const rect = el.getBoundingClientRect()

  // Cursor position relative to the scroll container viewport
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top

  // Position in the grid (content coordinates)
  const gridX = el.scrollLeft + cx
  const gridY = el.scrollTop + cy

  const oldSize = cellSize.value
  const scale = 1 - e.deltaY * 0.005
  const newSize = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(oldSize * scale)))
  if (newSize === oldSize) return
  cellSize.value = newSize

  // Adjust scroll so the point under the cursor stays put
  const ratio = newSize / oldSize
  el.scrollLeft = gridX * ratio - cx
  el.scrollTop = gridY * ratio - cy
}

function updateSize() {
  if (!scrollContainer.value) return
  viewportWidth.value = scrollContainer.value.clientWidth
  viewportHeight.value = scrollContainer.value.clientHeight
}

onMounted(async () => {
  window.addEventListener('resize', updateSize)
  scrollContainer.value?.addEventListener('touchmove', onTouchMove, { passive: false })
  scrollContainer.value?.addEventListener('wheel', onWheel, { passive: false })

  await nextTick()
  updateSize()
  if (scrollContainer.value) {
    scrollTop.value = scrollContainer.value.scrollTop
    scrollLeft.value = scrollContainer.value.scrollLeft
  }

  // Load claimed set then start loading
  try {
    const { ownership } = await fetchOwnership()
    const set = new Set<number>()
    for (const id of ownership.keys()) set.add(Number(id))
    claimedSet.value = set
  } catch { /* silently fail */ }

  hasMounted = true
  loadVisible()
})

onUnmounted(() => {
  window.removeEventListener('resize', updateSize)
  scrollContainer.value?.removeEventListener('touchmove', onTouchMove)
  scrollContainer.value?.removeEventListener('wheel', onWheel)
})

useHead({ title: 'all vessels' })
</script>

<style scoped>
.grid-page {
  font-family: var(--font-mono);
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.grid-toolbar {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  flex-shrink: 0;

  .back-link {
    margin-bottom: 0;
  }
}

.zoom-controls {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.grid-info {
  color: var(--muted);
  margin-left: auto;
}

.grid-scroll {
  flex: 1;
  overflow: auto;
  touch-action: pan-x pan-y;
}

.grid-sizer {
  position: relative;
  overflow: hidden;
}

.grid-viewport {
  display: grid;
  gap: 0;
}

.grid-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  margin: -0.5px;
  cursor: pointer;
  overflow: hidden;
  background: var(--background);

  &:hover {
    border-color: var(--color);
    z-index: 1;
  }

  &.cell-machine:hover { border-color: var(--color-machine); }
  &.cell-vault:hover { border-color: var(--color-vault); }
  &.cell-capsule:hover { border-color: var(--color-capsule); }

  &.claimed {
    background: var(--bg-subtle);
  }
}

.cell-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.cell-id {
  font-size: 9px;
  color: var(--text-faint);
  user-select: none;
}

@media (max-width: 640px) {
  .grid-toolbar {
    padding: 0.75rem 1rem;
    gap: 0.5rem;
    font-size: 12px;
  }
}
</style>
