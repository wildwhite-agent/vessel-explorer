<template>
  <div v-if="content.type !== 'binary'" class="content-view">
    <!-- Text: single panel only -->
    <div v-if="content.type === 'text'" class="content-single">
      <div class="panel">
        <div class="panel-header">text</div>
        <div class="panel-body">
          <pre class="rendered-text">{{ content.text }}</pre>
        </div>
      </div>
    </div>

    <!-- Bytecode: disassembly + raw bytes -->
    <div v-else-if="content.type === 'bytecode'" class="content-panels bytecode-panels">
      <div class="panel panel-source">
        <div class="panel-header">
          bytecode
          <button class="panel-action-btn" @click="copyBytecode">
            {{ copiedBytecode ? '[copied]' : '[copy]' }}
          </button>
        </div>
        <div class="panel-body">
          <pre class="bytecode-text">{{ formattedBytecode }}</pre>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          evm disassembly
          <button class="panel-action-btn" @click="copyDisassembly">
            {{ copiedDisassembly ? '[copied]' : '[copy]' }}
          </button>
        </div>
        <div class="panel-body">
          <pre class="bytecode-text">{{ formattedDisassembly }}</pre>
        </div>
      </div>
    </div>

    <!-- SVG/HTML: dual panels -->
    <div v-else class="content-panels">
      <div class="panel panel-source">
        <div class="panel-header">source</div>
        <div class="panel-body">
          <pre class="source-pre"><code><template v-for="(line, i) in sourceLines" :key="i"><span class="line-num">{{ String(i + 1).padStart(lineNumWidth, ' ') }}</span> <span v-html="highlightedLines[i]"></span>
</template></code></pre>
        </div>
      </div>
      <div class="panel panel-rendered">
        <div class="panel-header">
          rendered
          <button
            v-if="content.type === 'html'"
            :class="['panel-action-btn', { active: scriptsEnabled }]"
            @click="scriptsEnabled = !scriptsEnabled"
          >
            {{ scriptsEnabled ? '[running]' : '[run]' }}
          </button>
        </div>
        <div class="panel-body rendered-body">
          <img
            v-if="content.type === 'svg'"
            :src="svgDataUri"
            class="rendered-img"
            alt="rendered svg"
          />
          <iframe
            v-else-if="content.type === 'html'"
            :key="'iframe-' + scriptsEnabled"
            :srcdoc="content.text || ''"
            :sandbox="scriptsEnabled ? 'allow-scripts' : ''"
            class="rendered-iframe"
          ></iframe>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { detectContent, formatEvmDisassembly, type DetectedContent } from '~/utils/content'

const props = defineProps<{
  data: Uint8Array
}>()

const content = computed<DetectedContent>(() => detectContent(props.data))
const scriptsEnabled = ref(false)
const copiedBytecode = ref(false)
const copiedDisassembly = ref(false)

const sourceLines = computed(() => {
  if (!content.value.text) return []
  return content.value.text.split('\n')
})

const lineNumWidth = computed(() => String(sourceLines.value.length).length)

const highlightedLines = computed(() => {
  return sourceLines.value.map((line: string) => {
    // Escape all HTML entities — this is the source view, everything must be visible as text
    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    return escaped
  })
})

const formattedBytecode = computed(() => {
  if (content.value.type !== 'bytecode' || !content.value.text) return ''
  // Format as rows of 32 bytes with offset
  const hex = content.value.text
  const lines = []
  for (let i = 0; i < hex.length; i += 64) {
    const offset = (i / 2).toString(16).padStart(4, '0')
    const chunk = hex.slice(i, i + 64).match(/.{1,2}/g)?.join(' ') || ''
    lines.push(`${offset}  ${chunk}`)
  }
  return lines.join('\n')
})

const formattedDisassembly = computed(() => {
  if (content.value.type !== 'bytecode' || !content.value.text) return ''
  return formatEvmDisassembly(content.value.text)
})

async function copyBytecode() {
  if (content.value.type !== 'bytecode' || !content.value.text) return
  await copyPanelText('bytecode', `0x${content.value.text}`)
}

async function copyDisassembly() {
  if (!formattedDisassembly.value) return
  await copyPanelText('disassembly', formattedDisassembly.value)
}

async function copyPanelText(kind: 'bytecode' | 'disassembly', text: string) {
  await navigator.clipboard.writeText(text)
  if (kind === 'bytecode') {
    copiedBytecode.value = true
    setTimeout(() => { copiedBytecode.value = false }, 2000)
  } else {
    copiedDisassembly.value = true
    setTimeout(() => { copiedDisassembly.value = false }, 2000)
  }
}

const svgDataUri = computed(() => {
  if (content.value.type !== 'svg' || !content.value.text) return ''
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(content.value.text)))
})
</script>

<style scoped>
.content-view {
  margin-top: 1.5rem;
  font-family: var(--font-mono);
  font-size: 13px;
  width: 100%;
  min-width: 0;
}

.content-single {
  --decoded-panel-max-height: min(70vh, 32rem);
  border: 1px solid var(--border-color);
  max-height: var(--decoded-panel-max-height);
  overflow: hidden;
}

.content-single .panel {
  max-height: var(--decoded-panel-max-height);
}

.content-panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  border: 1px solid var(--border-color);
  height: clamp(20rem, 55vh, 34rem);
  overflow: hidden;
}

.panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.panel-source {
  border-right: 1px solid var(--border-color);
}

.panel-header {
  padding: 0 0.75rem;
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 2rem;
  flex-shrink: 0;
  box-sizing: border-box;
}

.panel-action-btn {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  text-transform: uppercase;
  line-height: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  min-inline-size: auto;

  &:hover {
    color: var(--color);
  }

  &.active {
    color: var(--sh-string, #4ade80);
  }
}

.panel-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.source-pre {
  margin: 0;
  padding: 0.5rem 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  tab-size: 2;
}

.source-pre code {
  font-family: inherit;
}

.line-num {
  display: inline-block;
  color: var(--text-faint);
  user-select: none;
  text-align: right;
  padding: 0 0.75rem 0 0.5rem;
}

.rendered-body {
  position: relative;
  background: var(--bg-subtle);
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.rendered-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #fff;
  padding: 1rem;
  box-sizing: border-box;
}

.rendered-iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.bytecode-text {
  margin: 0;
  padding: 0.75rem;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre;
  color: var(--muted);
}

.rendered-text {
  margin: 0;
  padding: 0.75rem;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  width: 100%;
  align-self: flex-start;
  box-sizing: border-box;
}

@media (max-width: 640px) {
  .content-panels {
    grid-template-columns: 1fr;
    height: auto;
  }

  .panel-source {
    border-right: none;
    border-bottom: 1px solid var(--border-color);
  }

  .content-panels .panel {
    height: clamp(14rem, 44vh, 24rem);
  }

  .content-single {
    --decoded-panel-max-height: min(65vh, 28rem);
  }
}
</style>
