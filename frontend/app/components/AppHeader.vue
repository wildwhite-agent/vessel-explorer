<template>
  <header class="app-header">
    <NuxtLink to="/" class="app-title">vessel explorer</NuxtLink>
    <Tooltip v-if="statsLoading || claimed != null || statsError" side="bottom" align="center" :side-offset="8" :delay-duration="100" :arrow="false">
      <template #trigger>
        <span class="header-stats">
          <template v-if="statsLoading">loading stats...</template>
          <template v-else-if="statsError">{{ statsError }}</template>
          <template v-else>{{ claimed }} claimed</template>
        </span>
      </template>
      <div class="stats-popover">
        <div class="stats-row" v-if="statsLoading">
          <span class="stats-label">stats</span>
          <span class="stats-value">loading...</span>
        </div>
        <div class="stats-row" v-else-if="statsError">
          <span class="stats-label">stats</span>
          <span class="stats-value">{{ statsError }}</span>
        </div>
        <div class="stats-row">
          <span class="stats-label">capacity claimed</span>
          <span class="stats-value">{{ formatBytes(claimedCapacity) }} <span class="stat-sep">/ {{ formatBytes(TOTAL_CAPACITY) }}</span></span>
        </div>
        <div class="stats-row">
          <span class="stats-label">bytes filled</span>
          <span class="stats-value">
            <template v-if="filledBytes != null">{{ formatBytes(filledBytes) }}</template>
            <template v-else>loading...</template>
          </span>
        </div>
        <div class="stats-row" v-if="holderCount">
          <span class="stats-label">unique holders</span>
          <span class="stats-value">{{ holderCount }}</span>
        </div>
        <div class="stats-row" v-if="holderCount && claimed">
          <span class="stats-label">avg vessels/holder</span>
          <span class="stats-value">{{ (claimed / holderCount).toFixed(1) }}</span>
        </div>
        <div class="stats-row" v-if="largestHolder">
          <span class="stats-label">largest holder</span>
          <span class="stats-value">
            <NuxtLink :to="`/address/${largestHolder.address}`" class="stats-link">
              <AddressDisplay :address="largestHolder.address" :link="false" />
            </NuxtLink>
            <span class="stat-sep"> ({{ largestHolder.count }})</span>
          </span>
        </div>
      </div>
    </Tooltip>
    <div class="header-actions desktop-actions">
      <NuxtLink to="/sequences" class="text-btn">[sequences]</NuxtLink>
      <NuxtLink to="/grid" class="text-btn">[grid]</NuxtLink>
      <NuxtLink to="/all" class="text-btn">[all]</NuxtLink>
      <button class="text-btn" @click="toggleDark">
        {{ isDark ? '[light]' : '[dark]' }}
      </button>
    </div>
    <Dropdown
      v-model:open="menuOpen"
      class="header-menu-dropdown"
      side="bottom"
      align="end"
      :side-offset="8"
      :arrow="false"
      :modal="false"
    >
      <template #trigger>
        <button
          type="button"
          class="text-btn mobile-menu-trigger"
          :aria-expanded="menuOpen"
          aria-label="Open navigation menu"
        >
          [menu]
        </button>
      </template>

      <DropdownItem text-value="sequences" @select="goTo('/sequences')">
        [sequences]
      </DropdownItem>
      <DropdownItem text-value="grid" @select="goTo('/grid')">
        [grid]
      </DropdownItem>
      <DropdownItem text-value="all" @select="goTo('/all')">
        [all]
      </DropdownItem>
      <DropdownItem :text-value="isDark ? 'light' : 'dark'" @select="toggleDarkFromMenu">
        {{ isDark ? '[light]' : '[dark]' }}
      </DropdownItem>
    </Dropdown>
  </header>
</template>

<script setup lang="ts">
const COLOR_MODE_KEY = 'vessel-color-mode'
const isDark = ref(true)
const menuOpen = ref(false)
const { stats, loadHeaderStats } = useHeaderStats()
const claimed = computed(() => stats.value.claimed)
const holderCount = computed(() => stats.value.holderCount)
const largestHolder = computed(() => stats.value.largestHolder)
const filledBytes = computed(() => stats.value.filledBytes)
const statsLoading = computed(() => stats.value.loading || (!stats.value.loaded && !stats.value.error))
const statsError = computed(() => stats.value.error)

const TOTAL_CAPACITY = 50_005_000
const claimedCapacity = computed(() => stats.value.claimedCapacity)

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

onMounted(async () => {
  const root = document.documentElement
  const stored = localStorage.getItem(COLOR_MODE_KEY)
  const shouldBeDark = stored ? stored === 'dark' : true
  root.classList.toggle('dark', shouldBeDark)
  isDark.value = shouldBeDark

  void loadHeaderStats()
})

function toggleDark() {
  const root = document.documentElement
  root.classList.toggle('dark')
  isDark.value = root.classList.contains('dark')
  localStorage.setItem(COLOR_MODE_KEY, isDark.value ? 'dark' : 'light')
}

function toggleDarkFromMenu() {
  toggleDark()
  menuOpen.value = false
}

function goTo(path: string) {
  menuOpen.value = false
  void navigateTo(path)
}
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  font-family: var(--font-mono);
  font-size: 14px;
}

.app-title {
  color: var(--color);
  text-decoration: none;
  font-weight: 700;
  text-transform: lowercase;
}

.header-stats {
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;

  &:hover {
    color: var(--color);
  }
}

.stat-sep {
  color: var(--text-faint);
}

.stats-popover {
  font-family: var(--font-mono);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.25rem 0;
  min-width: 14rem;
}

.stats-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.stats-label {
  color: var(--muted);
}

.stats-value {
  color: var(--color);
  text-align: right;
}

.stats-link {
  color: var(--color);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.mobile-menu-trigger {
  display: none;
}

:global(.header-menu-dropdown) {
  --dropdown-border-radius: 0;
  --dropdown-padding: 0.25rem;
  min-inline-size: 8rem;
  font-family: var(--font-mono);
  font-size: 13px;
}

:global(.header-menu-dropdown .dropdown-item) {
  justify-content: flex-end;
  border-radius: 0;
  padding: 0.45rem 0.65rem;
  text-align: right;
}

@media (max-width: 640px) {
  .header-stats {
    display: none;
  }

  .desktop-actions {
    display: none;
  }

  .mobile-menu-trigger {
    display: inline-flex;
  }
}
</style>
