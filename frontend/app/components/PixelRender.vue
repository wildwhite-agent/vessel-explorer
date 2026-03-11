<template>
  <div class="pixel-render">
    <div class="pixel-meta">{{ cols }} x {{ rows }} (mode {{ colorMode }}: {{ colorModeName(colorMode) }})</div>
    <div class="pixel-frame">
      <img
        v-if="dataUrl"
        :src="dataUrl"
        :width="cols * scale"
        :height="rows * scale"
        class="pixel-image"
        alt="vessel pixel render"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { renderPixels, getGridDimensions, colorModeName, type ColorMode } from '~/utils/vessel'

const props = withDefaults(defineProps<{
  data: Uint8Array
  tokenId: number
  thumbnail?: boolean
  colorMode?: ColorMode
}>(), { colorMode: 0 })

const { cols, rows } = getGridDimensions(props.tokenId)

const scale = computed(() => (props.thumbnail ? 2 : Math.max(1, Math.floor(400 / Math.max(cols, rows)))))

const dataUrl = computed(() => {
  if (!props.data.length) return null
  return renderPixels(props.data, props.tokenId, props.colorMode)
})
</script>

<style scoped>
.pixel-render {
  font-family: var(--font-mono);
  font-size: 13px;
}

.pixel-meta {
  color: var(--muted);
  margin-bottom: 0.5rem;
}

.pixel-frame {
  display: flex;
  justify-content: center;
  padding: 1rem;
  background: var(--bg-subtle);
  border: 1px solid var(--border-color);
}

.pixel-image {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
</style>
