export type VesselSearchQuery =
  | { kind: 'empty'; value: '' }
  | { kind: 'token'; value: string }
  | { kind: 'address'; value: string }
  | { kind: 'ens'; value: string }
  | { kind: 'invalid'; value: string }

export const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/

export function parseVesselSearchQuery(input: string): VesselSearchQuery {
  const value = safeDecode(input).trim()
  if (!value) return { kind: 'empty', value: '' }
  if (/^\d+$/.test(value)) return { kind: 'token', value }
  if (ADDRESS_PATTERN.test(value)) return { kind: 'address', value }
  if (isEnsName(value)) return { kind: 'ens', value }
  return { kind: 'invalid', value }
}

export function isEnsName(value: string) {
  return value.includes('.') && !/[\s/]/.test(value)
}

export function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
