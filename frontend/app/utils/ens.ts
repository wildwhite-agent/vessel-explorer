export interface EnsResolution {
  name: string | null
  address: string
}

export async function resolveEnsName(name: string) {
  return await $fetch<EnsResolution>(`/api/ens/${encodeURIComponent(name)}`)
}
