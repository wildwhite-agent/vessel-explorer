<template>
  <div v-if="content.type !== 'binary'" class="content-view">
    <div class="content-panels">
      <div class="panel panel-source">
        <div class="panel-header">source</div>
        <div class="panel-body">
          <pre class="source-pre"><code><template v-for="(line, i) in sourceLines" :key="i"><span class="line-num">{{ String(i + 1).padStart(lineNumWidth, ' ') }}</span> <span v-if="highlighted" v-html="highlightedLines[i]"></span><span v-else>{{ line }}</span>
</template></code></pre>
        </div>
      </div>
      <div class="panel panel-rendered">
        <div class="panel-header">rendered</div>
        <div class="panel-body rendered-body">
          <img
            v-if="content.type === 'svg'"
            :src="svgDataUri"
            class="rendered-img"
            alt="rendered svg"
          />
          <iframe
            v-else-if="content.type === 'html'"
            :srcdoc="content.text"
            sandbox="allow-same-origin"
            class="rendered-iframe"
          ></iframe>
          <pre v-else class="rendered-text">{{ content.text }}</pre>
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

const sourceLines = computed(() => {
  if (!content.value.text) return []
  return content.value.text.split('\n')
})

const lineNumWidth = computed(() => String(sourceLines.value.length).length)

const highlighted = computed(() =>
  content.value.type === 'svg' || content.value.type === 'html'
)

const highlightedLines = computed(() => {
  if (!highlighted.value) return []
  return sourceLines.value.map((line: string) => highlightMarkup(line))
})

function highlightMarkup(line: string): string {
  return line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/(&lt;\/?[\w:-]+)/g, '<span class="sh-keyword">$1</span>')
    .replace(/([\w:-]+)=/g, '<span class="sh-type">$1</span>=')
    .replace(/=(&quot;|")(.*?)(\1|")/g, '=<span class="sh-string">"$2"</span>')
    .replace(/(&lt;!--.*?--&gt;)/g, '<span class="sh-comment">$1</span>')
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
}

.content-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--border-color);
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
  padding: 0.4rem 0.75rem;
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-subtle);
}

.panel-body {
  max-height: 28rem;
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
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 8rem;
  background: var(--bg-subtle);
}

.rendered-img {
  max-width: 100%;
  max-height: 28rem;
  object-fit: contain;
  background: #fff;
  padding: 1rem;
}

.rendered-iframe {
  width: 100%;
  height: 28rem;
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
