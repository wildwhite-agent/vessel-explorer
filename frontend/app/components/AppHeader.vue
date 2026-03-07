<template>
  <header class="app-header">
    <NuxtLink to="/" class="app-title">vessel explorer</NuxtLink>
    <div class="header-actions">
      <button class="text-btn" @click="toggleDark">
        {{ isDark ? '[light]' : '[dark]' }}
      </button>
      <ClientOnly>
        <EvmConnectDialog class-name="text-btn" />
      </ClientOnly>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useAccount } from '@wagmi/vue'

const isDark = ref(true)
const router = useRouter()
const { address } = useAccount()

onMounted(() => {
  const root = document.documentElement
  if (!root.classList.contains('dark')) {
    root.classList.add('dark')
  }
  isDark.value = root.classList.contains('dark')
})

function toggleDark() {
  const root = document.documentElement
  root.classList.toggle('dark')
  isDark.value = root.classList.contains('dark')
}

// Auto-navigate to profile on wallet connect
watch(address, (addr) => {
  if (addr) {
    router.push(`/address/${addr}`)
  }
})
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}
</style>
