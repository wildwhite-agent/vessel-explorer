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
            :class="['run-btn', { active: scriptsEnabled }]"
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
            :srcdoc="content.text"
            :sandbox="scriptsEnabled ? 'allow-scripts' : ''"
            class="rendered-iframe"
          ></iframe>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { detectContent, type DetectedContent } from '~/utils/content'

const props = defineProps<{
  data: Uint8Array
}>()

const content = computed<DetectedContent>(() => detectContent(props.data))
const scriptsEnabled = ref(false)

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
}

.content-single {
  border: 1px solid var(--border-color);
}

.content-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--border-color);
  height: 20rem;
}

.panel {
  min-width: 0;
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

.run-btn {
  background: none;
  border: none;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  text-transform: lowercase;
  line-height: 1;

  &:hover {
    color: var(--color);
  }

  &.active {
    color: var(--sh-string, #4ade80);
  }
}

.panel-body {
  flex: 1;
  overflow: auto;
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
}

.rendered-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #fff;
  padding: 1rem;
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

.rendered-text {
  margin: 0;
  padding: 0.75rem;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
  align-self: flex-start;
}

@media (max-width: 640px) {
  .content-panels {
    grid-template-columns: 1fr;
  }

  .panel-source {
    border-right: none;
    border-bottom: 1px solid var(--border-color);
  }

  .panel-body {
    max-height: 20rem;
  }

  .rendered-iframe {
    height: 20rem;
  }
}
</style>
