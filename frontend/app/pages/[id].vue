<template>
  <div class="detail-page">
    <AppHeader />

    <div class="detail-content">
      <NuxtLink to="/" class="back-link">[back]</NuxtLink>

      <div v-if="loading" class="status">loading vessel #{{ id }}...</div>
      <div v-else-if="error" class="status status-error">{{ error }}</div>

      <template v-else-if="vessel">
        <div class="detail-header">
          <h1 class="vessel-title">
            vessel #{{ vessel.id }}
            <span :class="['type-badge', `type-${vessel.type}`]">[{{ vessel.type }}]</span>
          </h1>

          <div class="vessel-meta">
            <div class="meta-row">
              <span class="meta-label">owner</span>
              <span class="meta-value"><AddressDisplay :address="vessel.owner" /></span>
            </div>
            <div v-if="vessel.delegate" class="meta-row">
              <span class="meta-label">delegate</span>
              <span class="meta-value"><AddressDisplay :address="vessel.delegate" /></span>
            </div>
            <div v-if="vessel.type === 'machine' && vessel.machineHolder" class="meta-row">
              <span class="meta-label">machine</span>
              <span class="meta-value">
                <AddressDisplay :address="vessel.machineHolder" />
                <template v-if="vessel.machineName"> ({{ vessel.machineName }})</template>
              </span>
            </div>
            <div class="meta-row">
              <span class="meta-label">entries</span>
              <span class="meta-value">{{ vessel.entryCount }}</span>
            </div>
          </div>
        </div>

        <div v-if="vessel.type === 'machine' && vessel.machineHolder" class="machine-note">
          sourced from <AddressDisplay :address="vessel.machineHolder" />
        </div>

        <div class="grid-toolbar">
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
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()

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

.back-link {
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
  display: inline-block;
  margin-bottom: 1rem;

  &:hover {
    color: var(--color);
  }
}

.status {
  color: var(--muted);
  font-size: 13px;
  padding: 1rem 0;
}

.status-error {
  color: var(--error);
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
}

.type-badge {
  font-size: 13px;
  font-weight: 700;
  text-transform: lowercase;
}

.type-capsule { color: var(--accent); }
.type-vault { color: var(--sh-string); }
.type-machine { color: var(--sh-keyword); }

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
  width: 6rem;
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

.grid-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.entry-selector {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.entry-btn {
  background: none;
  border: 1px solid var(--border-color);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  padding: 0.25rem 0.6rem;
  text-align: center;
  min-width: 5rem;

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

  & .active {
    color: var(--accent);
    font-weight: 700;
  }
}
</style>
