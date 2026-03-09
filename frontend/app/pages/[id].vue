<template>
  <div class="detail-page">
    <AppHeader />

    <div class="detail-content">
      <div class="nav-bar">
        <a href="#" class="back-link" @click.prevent="$router.back()">[back]</a>
        <button class="text-btn" @click="randomVessel">[random]</button>
      </div>

      <div v-if="loading" class="status">loading vessel #{{ id }}...</div>
      <div v-else-if="error" class="status status-error">{{ error }}</div>

      <Transition name="vessel-in">
      <div v-if="vessel" :key="vessel.id" class="vessel-loaded">
        <div class="detail-header">
          <h1 class="vessel-title">
            vessel #{{ vessel.id }}
            <span :class="['type-badge', `type-${vessel.type}`]">[{{ vessel.type }}]</span>
            <span v-if="!vessel.claimed" class="type-badge unclaimed">[unclaimed]</span>
            <span v-if="vessel.locked" class="type-badge locked">[locked]</span>
          </h1>

          <div class="vessel-meta">
            <div v-if="vessel.owner" class="meta-row">
              <span class="meta-label">owner</span>
              <span class="meta-value"><AddressDisplay :address="vessel.owner" /></span>
            </div>
            <div v-if="vessel.delegate" class="meta-row">
              <span class="meta-label">delegate</span>
              <span class="meta-value"><AddressDisplay :address="vessel.delegate" /></span>
            </div>
            <div v-if="vessel.type === 'machine' && vessel.machineAddress" class="meta-row">
              <span class="meta-label">machine</span>
              <span class="meta-value">
                <AddressDisplay :address="vessel.machineAddress" external />
                <template v-if="vessel.machineName"> ({{ vessel.machineName }})</template>
              </span>
            </div>
            <div class="meta-row">
              <span class="meta-label">type</span>
              <span class="meta-value">{{ vessel.type }}</span>
            </div>
            <div v-if="vessel.type === 'vault'" class="meta-row">
              <span class="meta-label">entries</span>
              <span class="meta-value">{{ vessel.entryCount }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">color mode</span>
              <span class="meta-value">{{ vessel.colorMode === 0 ? 'grayscale' : vessel.colorMode }}</span>
            </div>
            <div v-if="vessel.claimBlock" class="meta-row">
              <span class="meta-label">claimed at</span>
              <span class="meta-value">block {{ vessel.claimBlock }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">capacity</span>
              <span class="meta-value">{{ vessel.id }} bytes</span>
            </div>
          </div>
        </div>

        <div v-if="vessel.type === 'machine' && vessel.machineAddress" class="machine-note">
          sourced from <AddressDisplay :address="vessel.machineAddress" external />
        </div>

        <div v-if="vessel.type === 'vault' && vessel.entries.length > 1" class="entry-selector">
          <button
            v-for="(_, idx) in vessel.entries"
            :key="idx"
            :class="['entry-btn', { active: activeEntry === idx }]"
            @click="activeEntry = idx"
          >
            entry {{ idx }}
          </button>
        </div>

        <div class="grid-controls">
          <button
            :class="['text-btn', { active: showBytes }]"
            @click="showBytes = !showBytes"
          >
            [bytes]
          </button>
          <button
            v-if="activePayload?.length"
            class="text-btn"
            @click="copyBytes"
          >
            {{ copied ? '[copied]' : '[copy]' }}
          </button>
        </div>

        <ClientOnly>
          <PixelGrid
            v-if="activePayload?.length"
            :data="activePayload"
            :token-id="vessel.id"
            :show-bytes="showBytes"
          />
          <div v-else class="status empty-label">empty</div>
        </ClientOnly>

        <ContentView
          v-if="activePayload?.length && contentType !== 'binary'"
          :data="activePayload"
        />
      </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { detectContent } from '~/utils/content'
import { fetchVesselActivity } from '~/utils/etherscan'

const router = useRouter()
const route = useRoute()

// Random vessel navigation (same logic as index — only vessels with writes)
const activeVesselIds = ref<string[]>([])

async function randomVessel() {
  if (!activeVesselIds.value.length) {
    const all = await fetchVesselActivity()
    const ids = new Set<string>()
    for (const tx of all) {
      if (tx.vesselId && tx.action === 'write') ids.add(tx.vesselId)
    }
    activeVesselIds.value = [...ids]
  }
  if (!activeVesselIds.value.length) return
  const pick = activeVesselIds.value[Math.floor(Math.random() * activeVesselIds.value.length)]
  router.push(`/${pick}`)
}

const id = computed(() => {
  const raw = route.params.id as string
  const n = parseInt(raw, 10)
  return isNaN(n) ? undefined : n
})

const { vessel, loading, error } = useVesselReader(id)

const showBytes = ref(false)
const copied = ref(false)

// Default to latest entry for vaults
const activeEntry = ref(0)
watch(vessel, (v) => {
  if (v && v.type === 'vault' && v.entries.length > 0) {
    activeEntry.value = v.entries.length - 1
  }
})

const activePayload = computed(() => {
  if (!vessel.value) return null
  if (vessel.value.type === 'vault' && vessel.value.entries.length > 0) {
    return vessel.value.entries[activeEntry.value] || null
  }
  return vessel.value.payload
})

const contentType = computed(() => {
  if (!activePayload.value?.length) return 'binary'
  return detectContent(activePayload.value).type
})

// Dynamic OG tags
const ogDescription = computed(() => {
  if (!vessel.value) return ''
  const type = vessel.value.type?.toLowerCase() || 'unknown'
  const hasData = vessel.value.payload && vessel.value.payload.length > 0
  if (!hasData && type === 'capsule') return 'empty capsule'
  if (type === 'vault' && vessel.value.entries.length > 0) return `vault · ${vessel.value.entries.length} entries`
  if (type === 'vault') return 'empty vault'
  if (type === 'machine') return 'machine'
  if (type === 'capsule') return 'capsule'
  return type
})

useHead(() => ({
  title: id.value ? `vessel #${id.value}` : 'vessel explorer',
  meta: [
    { property: 'og:title', content: id.value ? `vessel #${id.value}` : 'vessel explorer' },
    { property: 'og:description', content: ogDescription.value },
    { property: 'og:image', content: id.value ? `/api/og/${id.value}` : '' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: id.value ? `vessel #${id.value}` : 'vessel explorer' },
    { name: 'twitter:description', content: ogDescription.value },
    { name: 'twitter:image', content: id.value ? `/api/og/${id.value}` : '' },
  ],
}))

async function copyBytes() {
  if (!activePayload.value) return
  const hex = Array.from(activePayload.value)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  await navigator.clipboard.writeText('0x' + hex)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<style scoped>
.detail-page {
  font-family: var(--font-mono);
  max-width: 960px;
  margin: 0 auto;
}

.detail-content {
  padding: 1rem;
}

.nav-bar {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
}

.empty-label {
  text-align: center;
  padding: 3rem 0;
}

.detail-header {
  margin-bottom: 1.5rem;
}

.vessel-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 1rem 0;
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.type-badge {
  font-size: 13px;
  font-weight: 700;
  text-transform: lowercase;
}

.type-capsule { color: var(--color-capsule); }
.type-vault { color: var(--color-vault); }
.type-machine { color: var(--color-machine); }
.unclaimed { color: var(--text-faint); }
.locked { color: var(--error, #e06c75); }

.vessel-meta {
  font-size: 13px;
}

.meta-row {
  display: flex;
  gap: 1rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--border-color);
}

.meta-label {
  color: var(--muted);
  width: 7rem;
  flex-shrink: 0;
}

.meta-value {
  color: var(--color);
  overflow: hidden;
  text-overflow: ellipsis;
}

.machine-note {
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 0.75rem;
}

.entry-selector {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.entry-btn {
  background: none;
  border: 1px solid var(--border-color);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  min-width: 5rem;
  height: 1.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;

  &:hover {
    color: var(--color);
  }

  &.active {
    color: var(--accent);
    border-color: var(--accent);
    font-weight: 700;
  }
}

.grid-controls {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;

  & .active {
    color: var(--accent);
    font-weight: 700;
  }
}

.vessel-in-enter-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}

.vessel-in-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 640px) {
  .vessel-title {
    font-size: 16px;
  }

  .meta-row {
    flex-direction: column;
    gap: 0.15rem;
  }

  .meta-label {
    width: auto;
  }

  .meta-value {
    word-break: break-all;
  }

  .entry-btn {
    min-width: 4rem;
    font-size: 11px;
  }
}
</style>
