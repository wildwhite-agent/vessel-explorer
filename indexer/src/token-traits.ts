import { Buffer } from 'node:buffer'

export type TokenTraits = {
  roleLabel: string | null
  axiom: boolean
  relic: boolean
  relicKind: string | null
  machineName: string | null
}

const ROLE_LABELS: Record<number, string> = {
  0: 'Undefined',
  1: 'Navigator',
  2: 'Steward',
  3: 'Merchant',
}

export function roleLabelForRole(role: number | null | undefined) {
  if (role == null) return null
  return ROLE_LABELS[role] ?? null
}

export function parseTokenTraits(tokenUri: string | null | undefined, role: number | null | undefined): TokenTraits {
  const metadata = parseTokenMetadata(tokenUri)
  const attributes = Array.isArray(metadata?.attributes) ? metadata.attributes : []
  const roleLabel = stringTrait(attributes, 'Role') || roleLabelForRole(role)
  const relic = booleanTrait(attributes, 'Relic')

  return {
    roleLabel,
    axiom: booleanTrait(attributes, 'Axiom'),
    relic,
    relicKind: stringTrait(attributes, 'Relic Kind'),
    machineName: stringTrait(attributes, 'Machine Name'),
  }
}

function parseTokenMetadata(tokenUri: string | null | undefined) {
  const payload = decodeTokenUri(tokenUri)
  if (!payload) return null

  try {
    const parsed = JSON.parse(payload)
    return parsed && typeof parsed === 'object'
      ? parsed as { attributes?: unknown[] }
      : null
  } catch {
    return null
  }
}

function decodeTokenUri(tokenUri: string | null | undefined) {
  const value = String(tokenUri || '').trim()
  if (!value) return null
  if (value.startsWith('{')) return value
  if (!value.startsWith('data:')) return null

  const comma = value.indexOf(',')
  if (comma === -1) return null

  const meta = value.slice(0, comma).toLowerCase()
  const data = value.slice(comma + 1)

  try {
    if (meta.includes(';base64')) {
      return Buffer.from(data, 'base64').toString('utf8')
    }
    return decodeURIComponent(data)
  } catch {
    return null
  }
}

function stringTrait(attributes: unknown[], name: string) {
  const value = attributeValue(attributes, name)
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

function booleanTrait(attributes: unknown[], name: string) {
  const value = attributeValue(attributes, name)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return false

  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === 'yes' || normalized === '1'
}

function attributeValue(attributes: unknown[], name: string) {
  const wanted = normalizeTraitName(name)
  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== 'object') continue
    const row = attribute as Record<string, unknown>
    if (normalizeTraitName(String(row.trait_type ?? row.traitType ?? '')) === wanted) {
      return row.value
    }
  }
  return null
}

function normalizeTraitName(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, '')
}
