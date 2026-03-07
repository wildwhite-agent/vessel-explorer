<template>
  <div class="pixel-grid">
    <div class="grid-meta">{{ cols }} x {{ rows }} (mode 0: grayscale)</div>
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

const maxGridWidth = 600

const cellSize = computed(() => {
  const raw = Math.floor(maxGridWidth / Math.max(cols, rows))
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

@media (max-width: 640px) {
  .grid-frame {
    padding: 0.5rem;
  }
}
</style>
