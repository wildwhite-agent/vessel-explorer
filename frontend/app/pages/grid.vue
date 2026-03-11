<template>
  <div class="grid-page">
    <AppHeader />

    <div class="grid-toolbar">
      <button class="text-btn back-link" @click="handleBack">[back]</button>
      <div class="zoom-controls">
        <button class="text-btn" @click="zoomIn">[+]</button>
        <button class="text-btn" @click="zoomOut">[-]</button>
        <button class="text-btn" @click="viewAll">[view all]</button>
      </div>
      <span class="grid-info">{{ totalVessels }} vessels</span>
    </div>

    <div
      ref="scrollContainer"
      :class="['grid-scroll', { 'view-all-centered': isViewAllCentered, 'view-all-dragging': isOverviewDragging }]"
      @scroll="onScroll"
      @mousedown="onOverviewMouseDown"
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
        <canvas
          v-if="viewAllMode"
          ref="overviewCanvas"
          class="overview-canvas pixelated"
          @click="onOverviewClick"
        />
        <div
          v-else
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
            <span v-else-if="showCellLabels" class="cell-id" :style="{ fontSize: Math.max(6, cellSize * 0.15) + 'px' }">{{ id }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { readContract } from '@wagmi/core'
import { useConfig } from '@wagmi/vue'
import { VESSEL_ADDRESS, VESSEL_ABI, byteToRGB, getGridDimensions, hexToBytes, renderToCanvas, type ColorMode } from '~/utils/vessel'
import { fetchOwnership } from '~/composables/useOwnership'

const wagmiConfig = useConfig()
const router = useRouter()

const totalVessels = 10000
const scrollContainer = ref<HTMLElement | null>(null)
const overviewCanvas = ref<HTMLCanvasElement | null>(null)
const previousGridView = ref<{ cellSize: number; scrollTop: number; scrollLeft: number } | null>(null)
const isOverviewDragging = ref(false)
const suppressOverviewClick = ref(false)

// Square grid: 100x100 = 10,000
const gridSide = 100

// Zoom
const cellSize = ref(80)
const ZOOM_MIN = 16
const ZOOM_MAX = 120
const ZOOM_STEP = 8
const DETAIL_CELL_MIN = 16
const DETAIL_RENDER_LIMIT = 900
const viewAllMode = ref(false)
const isViewAllCentered = computed(() => (
  viewAllMode.value
  && gridSide * cellSize.value <= viewportWidth.value
  && gridSide * cellSize.value <= viewportHeight.value
))

function getFitAllCellSize() {
  const fit = Math.floor(Math.min(viewportWidth.value, viewportHeight.value) / gridSide)
  return Math.max(1, Math.min(ZOOM_MAX, fit))
}

function zoomIn() {
  viewAllMode.value = false
  cellSize.value = Math.min(ZOOM_MAX, cellSize.value + ZOOM_STEP)
}

function zoomOut() {
  viewAllMode.value = false
  cellSize.value = Math.max(ZOOM_MIN, cellSize.value - ZOOM_STEP)
}

function viewAll() {
  if (!viewAllMode.value && scrollContainer.value) {
    previousGridView.value = {
      cellSize: cellSize.value,
      scrollTop: scrollContainer.value.scrollTop,
      scrollLeft: scrollContainer.value.scrollLeft,
    }
  }
  viewAllMode.value = true
  cellSize.value = getFitAllCellSize()
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = 0
    scrollContainer.value.scrollLeft = 0
  }
  scrollTop.value = 0
  scrollLeft.value = 0
  void loadAllClaimedPayloads()
}

async function exitViewAll() {
  const previous = previousGridView.value
  viewAllMode.value = false

  if (previous) {
    cellSize.value = previous.cellSize
    await nextTick()
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = previous.scrollTop
      scrollContainer.value.scrollLeft = previous.scrollLeft
    }
    scrollTop.value = previous.scrollTop
    scrollLeft.value = previous.scrollLeft
  }
}

function handleBack() {
  if (viewAllMode.value) {
    void exitViewAll()
    return
  }

  router.push('/')
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
const showCellLabels = computed(() => cellSize.value >= 24)
const shouldLoadDetailedCells = computed(() => (
  cellSize.value >= DETAIL_CELL_MIN && visibleIds.value.length <= DETAIL_RENDER_LIMIT
))

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
const allClaimedPayloadsLoading = ref(false)
const allClaimedPayloadsLoaded = ref(false)
const overviewTileCache = new Map<string, ImageData>()

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
  if (!shouldLoadDetailedCells.value) return

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

let allClaimedToken = 0

async function loadAllClaimedPayloads() {
  if (allClaimedPayloadsLoading.value || allClaimedPayloadsLoaded.value || claimedSet.value.size === 0) return

  const token = ++allClaimedToken
  const claimedIds = [...claimedSet.value].sort((a, b) => a - b)
  allClaimedPayloadsLoading.value = true

  try {
    for (let i = 0; i < claimedIds.length && token === allClaimedToken; i += 10) {
      const batch = claimedIds.slice(i, i + 10).filter(id => !payloadCache.has(id))
      if (!batch.length) continue

      await Promise.all(
        batch.map(async (id) => {
          if (token !== allClaimedToken) return
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

    if (token === allClaimedToken) {
      allClaimedPayloadsLoaded.value = [...claimedSet.value].every(id => payloadCache.has(id))
    }
  } finally {
    if (token === allClaimedToken) {
      allClaimedPayloadsLoading.value = false
    }
  }
}

function buildOverviewTile(id: number, size: number): ImageData | null {
  const key = `${id}:${size}`
  const cached = overviewTileCache.get(key)
  if (cached) return cached

  const data = payloadCache.get(id)
  if (!data) return null

  const image = new ImageData(size, size)
  const { cols, rows } = getGridDimensions(id)

  for (let dy = 0; dy < size; dy++) {
    const srcRow = Math.min(rows - 1, Math.floor(dy * rows / size))
    for (let dx = 0; dx < size; dx++) {
      const srcCol = Math.min(cols - 1, Math.floor(dx * cols / size))
      const srcIndex = srcRow * cols + srcCol
      const value = srcIndex < data.length ? data[srcIndex]! : 0
      const [r, g, b] = byteToRGB(value, colorModeCache.get(id) ?? 0)
      const offset = (dy * size + dx) * 4
      image.data[offset] = r
      image.data[offset + 1] = g
      image.data[offset + 2] = b
      image.data[offset + 3] = 255
    }
  }

  overviewTileCache.set(key, image)
  return image
}

function renderOverviewCanvas() {
  if (!viewAllMode.value || !overviewCanvas.value) return

  const size = Math.max(1, cellSize.value)
  const width = gridSide * size
  const height = gridSide * size
  const canvas = overviewCanvas.value

  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const styles = getComputedStyle(document.documentElement)
  const background = styles.getPropertyValue('--background').trim() || '#000'
  const claimedBackground = styles.getPropertyValue('--bg-subtle').trim() || '#222'
  const border = styles.getPropertyValue('--border-color').trim() || '#333'
  const showBorder = size >= 4

  ctx.clearRect(0, 0, width, height)

  for (let row = 0; row < gridSide; row++) {
    for (let col = 0; col < gridSide; col++) {
      const id = row * gridSide + col + 1
      const x = col * size
      const y = row * size

      ctx.fillStyle = claimedSet.value.has(id) ? claimedBackground : background
      ctx.fillRect(x, y, size, size)

      const tile = buildOverviewTile(id, size)
      if (tile) {
        ctx.putImageData(tile, x, y)
      } else if (showBorder) {
        ctx.strokeStyle = border
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)
      }
    }
  }
}

let overviewRenderRaf = 0

function scheduleOverviewRender() {
  if (!viewAllMode.value) return
  if (overviewRenderRaf) return

  overviewRenderRaf = requestAnimationFrame(() => {
    overviewRenderRaf = 0
    renderOverviewCanvas()
  })
}

function onOverviewClick(e: MouseEvent) {
  if (suppressOverviewClick.value) {
    suppressOverviewClick.value = false
    return
  }

  if (!overviewCanvas.value) return

  const rect = overviewCanvas.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const col = Math.floor(x / cellSize.value)
  const row = Math.floor(y / cellSize.value)

  if (col < 0 || col >= gridSide || row < 0 || row >= gridSide) return

  const id = row * gridSide + col + 1
  if (id <= totalVessels) {
    router.push(`/${id}`)
  }
}

function getContentOffset(el: HTMLElement, size: number) {
  const contentWidth = gridSide * size
  const contentHeight = gridSide * size

  return {
    x: Math.max(0, (el.clientWidth - contentWidth) / 2),
    y: Math.max(0, (el.clientHeight - contentHeight) / 2),
  }
}

function applyZoomAtPoint(cx: number, cy: number, newSize: number) {
  const el = scrollContainer.value
  if (!el) return

  const oldSize = cellSize.value
  if (newSize === oldSize) return

  const oldOffset = getContentOffset(el, oldSize)
  const gridX = el.scrollLeft + cx - oldOffset.x
  const gridY = el.scrollTop + cy - oldOffset.y
  const ratio = newSize / oldSize

  cellSize.value = newSize

  const newOffset = getContentOffset(el, newSize)
  el.scrollLeft = Math.max(0, newOffset.x + gridX * ratio - cx)
  el.scrollTop = Math.max(0, newOffset.y + gridY * ratio - cy)
  scrollLeft.value = el.scrollLeft
  scrollTop.value = el.scrollTop
}

const overviewDragState = {
  startX: 0,
  startY: 0,
  startScrollLeft: 0,
  startScrollTop: 0,
}

function onOverviewMouseDown(e: MouseEvent) {
  if (!viewAllMode.value || e.button !== 0 || !scrollContainer.value) return

  isOverviewDragging.value = true
  suppressOverviewClick.value = false
  overviewDragState.startX = e.clientX
  overviewDragState.startY = e.clientY
  overviewDragState.startScrollLeft = scrollContainer.value.scrollLeft
  overviewDragState.startScrollTop = scrollContainer.value.scrollTop
  e.preventDefault()
}

function onOverviewMouseMove(e: MouseEvent) {
  if (!isOverviewDragging.value || !scrollContainer.value) return

  const dx = e.clientX - overviewDragState.startX
  const dy = e.clientY - overviewDragState.startY
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    suppressOverviewClick.value = true
  }

  scrollContainer.value.scrollLeft = Math.max(0, overviewDragState.startScrollLeft - dx)
  scrollContainer.value.scrollTop = Math.max(0, overviewDragState.startScrollTop - dy)
  scrollLeft.value = scrollContainer.value.scrollLeft
  scrollTop.value = scrollContainer.value.scrollTop
}

function endOverviewDrag() {
  isOverviewDragging.value = false
}

let scrollTimer: ReturnType<typeof setTimeout> | null = null
let hasMounted = false

watch(visibleIds, () => {
  if (!hasMounted) return
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => loadVisible(), 100)
})

watch(() => cellSize.value, () => {
  overviewTileCache.clear()
  scheduleOverviewRender()
})

watch(() => payloadCache.size, () => {
  scheduleOverviewRender()
})

watch(() => claimedSet.value.size, () => {
  scheduleOverviewRender()
})

watch(() => viewAllMode.value, async (active) => {
  if (!active) return
  await nextTick()
  scheduleOverviewRender()
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
  const minZoom = viewAllMode.value ? 1 : ZOOM_MIN
  const newSize = Math.min(ZOOM_MAX, Math.max(minZoom, Math.round(oldSize * scale)))
  lastPinchDist = dist
  if (newSize === oldSize) return
  if (!viewAllMode.value) {
    viewAllMode.value = false
    cellSize.value = newSize

    // Adjust scroll so midpoint stays under fingers
    const ratio = newSize / oldSize
    el.scrollLeft = gridX * ratio - cx
    el.scrollTop = gridY * ratio - cy
    return
  }

  applyZoomAtPoint(cx, cy, newSize)
}

function onTouchEnd(e: TouchEvent) {
  if (e.touches.length < 2) pinching = false
}

// Trackpad / ctrl+wheel zoom — centered on cursor
function onWheel(e: WheelEvent) {
  const el = scrollContainer.value!
  const rect = el.getBoundingClientRect()

  // Cursor position relative to the scroll container viewport
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top

  if (viewAllMode.value) {
    e.preventDefault()
    const scale = 1 - e.deltaY * 0.005
    const newSize = Math.min(ZOOM_MAX, Math.max(1, Math.round(cellSize.value * scale)))
    applyZoomAtPoint(cx, cy, newSize)
    return
  }

  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()

  // Position in the grid (content coordinates)
  const gridX = el.scrollLeft + cx
  const gridY = el.scrollTop + cy

  const oldSize = cellSize.value
  const scale = 1 - e.deltaY * 0.005
  const newSize = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(oldSize * scale)))
  if (newSize === oldSize) return
  viewAllMode.value = false
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
  if (viewAllMode.value) {
    cellSize.value = getFitAllCellSize()
  }
}

onMounted(async () => {
  window.addEventListener('resize', updateSize)
  window.addEventListener('mousemove', onOverviewMouseMove)
  window.addEventListener('mouseup', endOverviewDrag)
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
    allClaimedPayloadsLoaded.value = false
    if (viewAllMode.value) {
      void loadAllClaimedPayloads()
    }
  } catch { /* silently fail */ }

  hasMounted = true
  loadVisible()
})

onUnmounted(() => {
  window.removeEventListener('resize', updateSize)
  window.removeEventListener('mousemove', onOverviewMouseMove)
  window.removeEventListener('mouseup', endOverviewDrag)
  scrollContainer.value?.removeEventListener('touchmove', onTouchMove)
  scrollContainer.value?.removeEventListener('wheel', onWheel)
  if (overviewRenderRaf) {
    cancelAnimationFrame(overviewRenderRaf)
  }
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

.grid-scroll.view-all-centered {
  display: flex;
  justify-content: center;
  align-items: center;
}

.grid-scroll.view-all-centered,
.overview-canvas {
  cursor: grab;
}

.grid-scroll.view-all-dragging,
.grid-scroll.view-all-dragging .overview-canvas {
  cursor: grabbing;
}

.grid-sizer {
  position: relative;
  overflow: hidden;
  flex: none;
}

.overview-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: pointer;
  image-rendering: pixelated;
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
