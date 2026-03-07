<template>
  <NuxtLink :to="`/address/${address}`" class="address-display">
    <template v-if="ens?.ens">{{ ens.ens }}</template>
    <template v-else>{{ shortened }}</template>
  </NuxtLink>
</template>

<script setup lang="ts">
const props = defineProps<{ address: string }>()

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
