<template>
  <div class="hex-dump">
    <div class="hex-meta">{{ data.length }} bytes</div>
    <div class="hex-lines">
      <div v-for="(line, i) in lines" :key="i" class="hex-line">
        <span class="hex-offset">{{ formatOffset(i * 16) }}</span>
        <span class="hex-bytes">{{ line.hex }}</span>
        <span class="hex-ascii">{{ line.ascii }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: Uint8Array }>()

interface HexLine {
  hex: string
  ascii: string
}

const lines = computed<HexLine[]>(() => {
  const result: HexLine[] = []
  const d = props.data
  for (let offset = 0; offset < d.length; offset += 16) {
    const chunk = d.slice(offset, offset + 16)
    const hexParts: string[] = []
    const asciiParts: string[] = []
    for (let i = 0; i < 16; i++) {
      if (i < chunk.length) {
        const byte = chunk[i]!
        hexParts.push(byte.toString(16).padStart(2, '0'))
        asciiParts.push(byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.')
      } else {
        hexParts.push('  ')
        asciiParts.push(' ')
      }
    }
    result.push({
      hex: hexParts.join(' '),
      ascii: asciiParts.join(''),
    })
  }
  return result
})

function formatOffset(n: number): string {
  return n.toString(16).padStart(8, '0')
}
</script>

<style scoped>
.hex-dump {
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-x: auto;
}

.hex-meta {
  color: var(--muted);
  margin-bottom: 0.5rem;
  font-size: 13px;
}

.hex-lines {
  background: var(--bg-subtle);
  border: 1px solid var(--border-color);
  padding: 0.5rem;
}

.hex-line {
  white-space: pre;
  line-height: 1.6;
}

.hex-offset {
  color: var(--sh-comment);
  margin-right: 1.5ch;
}

.hex-bytes {
  color: var(--sh-number);
  margin-right: 2ch;
}

.hex-ascii {
  color: var(--sh-string);
}
</style>
