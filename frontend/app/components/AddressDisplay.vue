<template>
  <a v-if="external" :href="`https://etherscan.io/address/${address}`" target="_blank" rel="noopener" class="address-display">
    <template v-if="ens?.ens">{{ ens.ens }}</template>
    <template v-else>{{ shortened }}</template>
  </a>
  <NuxtLink v-else :to="`/address/${address}`" class="address-display">
    <template v-if="ens?.ens">{{ ens.ens }}</template>
    <template v-else>{{ shortened }}</template>
  </NuxtLink>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  address: string
  external?: boolean
}>(), {
  external: false,
})

const { data: ens } = useEns(() => props.address)

const shortened = computed(() => {
  const a = props.address
  if (a.length <= 12) return a
  return `${a.slice(0, 6)}...${a.slice(-4)}`
})
</script>

<style scoped>
.address-display {
  font-family: var(--font-mono);
  color: var(--muted);
  text-decoration: none;

  &:hover {
    color: var(--color);
    text-decoration: underline;
  }
}
</style>
