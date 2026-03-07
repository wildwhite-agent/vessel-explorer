<template>
  <div class="detail-page">
    <AppHeader />

    <div class="detail-content">
      <NuxtLink to="/" class="back-link">&lt;- back</NuxtLink>

      <div v-if="loading" class="status">loading vessel #{{ id }}...</div>
      <div v-else-if="error" class="status status-error">{{ error }}</div>

      <template v-else-if="vessel">
        <div class="vessel-header">
          <h1 class="vessel-title">
            vessel #{{ vessel.id }}
            <span :class="['type-badge', `type-${vessel.type}`]">[{{ vessel.type }}]</span>
          </h1>
        </div>

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
              <template v-if="vessel.machineName">
                ({{ vessel.machineName }})
              </template>
            </span>
          </div>
          <div v-if="vessel.type === 'vault'" class="meta-row">
            <span class="meta-label">entries</span>
            <span class="meta-value">{{ vessel.entryCount }}</span>
          </div>
        </div>

        <div class="tabs">
          <button
            :class="['tab-btn', { active: activeTab === 'bytes' }]"
            @click="activeTab = 'bytes'"
          >
            [bytes]
          </button>
          <button
            :class="['tab-btn', { active: activeTab === 'rendered' }]"
            @click="activeTab = 'rendered'"
          >
            [rendered]
          </button>
        </div>

        <div class="tab-content">
          <!-- Bytes tab -->
          <template v-if="activeTab === 'bytes'">
            <template v-if="vessel.type === 'vault' && vessel.entries.length">
              <div
                v-for="(entry, idx) in vessel.entries"
                :key="idx"
                class="entry-section"
              >
                <button
                  class="entry-header"
                  @click="toggleEntry(idx)"
                >
                  {{ openEntries.has(idx) ? '[-]' : '[+]' }} entry {{ idx }}
                  <span class="entry-size">{{ entry.length }} bytes</span>
                </button>
                <div v-if="openEntries.has(idx)">
                  <HexDump :data="entry" />
                </div>
              </div>
            </template>

            <template v-else-if="vessel.type === 'machine'">
              <div class="machine-note">
                bytes sourced from {{ vessel.machineHolder }}
              </div>
              <HexDump v-if="vessel.payload" :data="vessel.payload" />
            </template>

            <template v-else>
              <HexDump v-if="vessel.payload" :data="vessel.payload" />
              <div v-else class="status">no payload data</div>
            </template>
          </template>

          <!-- Rendered tab -->
          <template v-if="activeTab === 'rendered'">
            <template v-if="vessel.type === 'vault' && vessel.entries.length">
              <div class="vault-grid">
                <div
                  v-for="(entry, idx) in vessel.entries"
                  :key="idx"
                  class="vault-thumb"
                >
                  <div class="thumb-label">entry {{ idx }}</div>
                  <ClientOnly>
                    <PixelRender
                      v-if="entry.length"
                      :data="entry"
                      :token-id="vessel.id"
                      thumbnail
                    />
                  </ClientOnly>
                </div>
              </div>
            </template>

            <template v-else>
              <ClientOnly>
                <PixelRender
                  v-if="vessel.payload?.length"
                  :data="vessel.payload"
                  :token-id="vessel.id"
                />
              </ClientOnly>
              <div v-if="!vessel.payload?.length" class="status">
                no payload data to render
              </div>
            </template>
          </template>
        </div>
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

const activeTab = ref<'bytes' | 'rendered'>('bytes')
const openEntries = ref(new Set<number>())

function toggleEntry(idx: number) {
  const s = new Set(openEntries.value)
  if (s.has(idx)) s.delete(idx)
  else s.add(idx)
  openEntries.value = s
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

.vessel-header {
  margin-bottom: 1rem;
}

.vessel-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
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
  margin-bottom: 1.5rem;
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

.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.5rem;
}

.tab-btn {
  background: none;
  border: none;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 13px;
  cursor: pointer;
  padding: 0.25rem 0.5rem;

  &:hover {
    color: var(--color);
  }

  &.active {
    color: var(--accent);
    font-weight: 700;
  }
}

.tab-content {
  padding-top: 0.5rem;
}

.entry-section {
  margin-bottom: 0.75rem;
}

.entry-header {
  background: none;
  border: none;
  color: var(--color);
  font-family: var(--font-mono);
  font-size: 13px;
  cursor: pointer;
  padding: 0.35rem 0;
  display: flex;
  gap: 0.75rem;
  width: 100%;
  text-align: left;

  &:hover {
    color: var(--accent);
  }
}

.entry-size {
  color: var(--muted);
}

.machine-note {
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 0.75rem;
}

.vault-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 1rem;
}

.vault-thumb {
  text-align: center;
}

.thumb-label {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 0.25rem;
}
</style>
