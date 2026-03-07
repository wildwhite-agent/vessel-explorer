<template>
  <a v-if="external" :href="`${ETHERSCAN_BASE}/address/${address}`" target="_blank" rel="noopener" class="address-display">
    <template v-if="ens?.ens">{{ ens.ens }}</template>
    <template v-else>{{ shortened }}</template>
  </a>
  <NuxtLink v-else :to="`/address/${address}`" class="address-display">
    <template v-if="ens?.ens">{{ ens.ens }}</template>
    <template v-else>{{ shortened }}</template>
  </NuxtLink>
</template>

<script setup lang="ts">
import { ETHERSCAN_BASE, shortenAddress } from '~/utils/vessel'

const props = withDefaults(defineProps<{
  address: string
  external?: boolean
}>(), {
  external: false,
})

const { data: ens } = useEns(() => props.address)

const shortened = computed(() => shortenAddress(props.address))
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
