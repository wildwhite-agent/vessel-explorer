import { createError } from 'h3'

export const MAX_ASSET_BYTES = 8 * 1024 * 1024
export const MAX_METADATA_BYTES = 1024 * 1024

export function requireVesselId(id: unknown): number {
  if (typeof id !== 'string' || !/^[1-9]\d{0,4}$/.test(id) || Number(id) > 10_000) {
    throw createError({ statusCode: 400, message: 'invalid vessel id' })
  }
  return Number(id)
}

export function requireSequenceId(id: unknown): string {
  // Sequence IDs are uint256, not bounded by the Vessel collection size.
  if (typeof id !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(id) || BigInt(id) >= 2n ** 256n) {
    throw createError({ statusCode: 400, message: 'invalid sequence id' })
  }
  return id
}

export function boundedPngDimensions(width: number, height: number, scale: number) {
  if (![width, height, scale].every(v => Number.isSafeInteger(v) && v > 0)) {
    throw createError({ statusCode: 502, message: 'invalid preview dimensions' })
  }
  const w = width * scale
  const h = height * scale
  if (w > 400 || h > 400 || w * h > 160_000) {
    throw createError({ statusCode: 502, message: 'preview dimensions exceeded' })
  }
  return { w, h }
}
