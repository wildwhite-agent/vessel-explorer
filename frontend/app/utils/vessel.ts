export const EXPLORER_BASE = 'https://evm.now' as const

export type VesselType = 'capsule' | 'vault' | 'machine'

// Color modes: 0 = grayscale, 1 = red, 2 = green, 3 = blue
export type ColorMode = 0 | 1 | 2 | 3

export function byteToRGB(v: number, mode: ColorMode = 0): [number, number, number] {
  switch (mode) {
    case 1: return [v, 0, 0]
    case 2: return [0, v, 0]
    case 3: return [0, 0, v]
    default: return [v, v, v]
  }
}

export function colorModeName(mode: ColorMode): string {
  switch (mode) {
    case 1: return 'red'
    case 2: return 'green'
    case 3: return 'blue'
    default: return 'grayscale'
  }
}

export function perceivedLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

// Roles: 0 = default, 2 = creator(?)
export type VesselRole = number

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (!clean.length) return new Uint8Array(0)
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function shortenAddress(a: string): string {
  if (a.length <= 12) return a
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}

export function renderToCanvas(canvas: HTMLCanvasElement, data: Uint8Array, tokenId: number, maxSize = 80, colorMode: ColorMode = 0) {
  const { cols, rows } = getGridDimensions(tokenId)
  const scale = Math.max(1, Math.floor(maxSize / Math.max(cols, rows)))
  canvas.width = cols * scale
  canvas.height = rows * scale

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.imageSmoothingEnabled = false
  const tmp = document.createElement('canvas')
  tmp.width = cols
  tmp.height = rows
  const tmpCtx = tmp.getContext('2d')!
  const img = tmpCtx.createImageData(cols, rows)
  for (let i = 0; i < cols * rows; i++) {
    const v = i < data.length ? data[i]! : 0
    const [r, g, b] = byteToRGB(v, colorMode)
    const off = i * 4
    img.data[off] = r
    img.data[off + 1] = g
    img.data[off + 2] = b
    img.data[off + 3] = 255
  }
  tmpCtx.putImageData(img, 0, 0)
  ctx.drawImage(tmp, 0, 0, cols * scale, rows * scale)
}

export function getGridDimensions(tokenId: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(tokenId))
  const rows = Math.ceil(tokenId / cols)
  return { cols, rows }
}

/**
 * Axioms are deterministic: capacity always equals the token id, and a vessel
 * is an axiom when that capacity is a perfect square (a full square grid). The
 * trait is therefore known before a claim mints the tokenURI metadata.
 */
export function isAxiomCapacity(capacityBytes: number | null | undefined): boolean {
  if (capacityBytes == null) return false
  const capacity = Number(capacityBytes)
  if (!Number.isSafeInteger(capacity) || capacity < 1) return false
  const root = Math.round(Math.sqrt(capacity))
  return root * root === capacity
}

/** Render pixel data to a data URL */
export function renderPixels(data: Uint8Array, tokenId: number, colorMode: ColorMode = 0): string {
  const { cols, rows } = getGridDimensions(tokenId)
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(cols, rows)

  for (let i = 0; i < cols * rows; i++) {
    const v = i < data.length ? data[i]! : 0
    const [r, g, b] = byteToRGB(v, colorMode)
    const off = i * 4
    img.data[off] = r
    img.data[off + 1] = g
    img.data[off + 2] = b
    img.data[off + 3] = 255
  }

  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

/** Format bytes as hex with spaces every 16 bytes */
export function formatHex(data: Uint8Array): string {
  return Array.from(data)
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ')
}
