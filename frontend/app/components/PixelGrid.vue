<template>
  <div class="pixel-grid">
    <div class="grid-meta">
      <span>{{ cols }} x {{ rows }} (mode 0: grayscale)</span>
      <span class="grid-meta-actions"><slot name="actions" /></span>
    </div>
    <div class="grid-frame">
      <div
        class="grid-container"
        :style="{
          gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
        }"
      >
        <div
          v-for="(byte, i) in cells"
          :key="i"
          class="grid-cell"
          :style="{
            backgroundColor: `rgb(${byte},${byte},${byte})`,
            width: cellSize + 'px',
            height: cellSize + 'px',
          }"
          :title="'0x' + byte.toString(16).padStart(2, '0')"
        >
          <span
            v-if="showBytes"
            class="cell-hex"
            :style="{ color: byte > 128 ? '#000' : '#fff' }"
          >{{ byte.toString(16).padStart(2, '0') }}</span>
        </div>
      </div>
    </div>
    <div class="grid-download">
      <button class="text-btn" @click="download">[download]</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getGridDimensions } from '~/utils/vessel'

const props = defineProps<{
  data: Uint8Array
  tokenId: number
  showBytes: boolean
}>()

const { cols, rows } = getGridDimensions(props.tokenId)

const EXPORT_CELL = 40 // px per cell in exported PNG

function download() {
  const w = cols * EXPORT_CELL
  const h = rows * EXPORT_CELL
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  // Draw cells
  for (let i = 0; i < cols * rows; i++) {
    const byte = i < props.data.length ? props.data[i]! : 0
    const x = (i % cols) * EXPORT_CELL
    const y = Math.floor(i / cols) * EXPORT_CELL
    ctx.fillStyle = `rgb(${byte},${byte},${byte})`
    ctx.fillRect(x, y, EXPORT_CELL, EXPORT_CELL)
  }

  // Draw hex bytes if showing
  if (props.showBytes) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.max(8, EXPORT_CELL * 0.35)}px monospace`
    for (let i = 0; i < cols * rows; i++) {
      const byte = i < props.data.length ? props.data[i]! : 0
      const x = (i % cols) * EXPORT_CELL + EXPORT_CELL / 2
      const y = Math.floor(i / cols) * EXPORT_CELL + EXPORT_CELL / 2
      ctx.fillStyle = byte > 128 ? '#000' : '#fff'
      ctx.fillText(byte.toString(16).padStart(2, '0'), x, y)
    }
  }

  const link = document.createElement('a')
  link.download = `vessel-${props.tokenId}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

const containerWidth = ref(600)

onMounted(() => {
  updateWidth()
  window.addEventListener('resize', updateWidth)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateWidth)
})

function updateWidth() {
  // Use viewport width minus padding
  containerWidth.value = Math.min(600, window.innerWidth - 48)
}

const cellSize = computed(() => {
  const raw = Math.floor(containerWidth.value / Math.max(cols, rows))
  return Math.max(4, Math.min(raw, 40))
})

const cells = computed(() => {
  const total = cols * rows
  const result: number[] = []
  for (let i = 0; i < total; i++) {
    result.push(i < props.data.length ? props.data[i]! : 0)
  }
  return result
})
</script>

<style scoped>
.pixel-grid {
  font-family: var(--font-mono);
  font-size: 13px;
}

.grid-meta {
  color: var(--muted);
  margin-bottom: 0.5rem;
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.grid-meta-actions {
  margin-left: auto;
  display: flex;
  gap: 0.5rem;
}

.grid-frame {
  display: flex;
  justify-content: center;
  padding: 1rem;
  background: var(--bg-subtle);
  border: 1px solid var(--border-color);
  overflow-x: auto;
}

.grid-container {
  display: grid;
  gap: 0;
}

.grid-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  image-rendering: pixelated;
}

.cell-hex {
  font-size: 8px;
  font-family: var(--font-mono);
  line-height: 1;
  pointer-events: none;
  user-select: none;
}

.grid-download {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

@media (max-width: 640px) {
  .grid-frame {
    padding: 0.5rem;
  }
}
</style>
