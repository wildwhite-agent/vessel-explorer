export const VESSEL_ADDRESS = '0xECb92Cc7112b80A2234936315BbB493fb48d1463' as const
export const RENDERER_ADDRESS = '0x85c7D2933f178A02Ee9AAC0E654094EaDAca48a2' as const
export const SEQUENCES_ADDRESS = '0x9423548a957284eD17E55c37c4B6D96e5E63065f' as const

export const VESSEL_ABI = [
  { type: 'function', name: 'ownerOf', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'getDelegate', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToPayload', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'bytes' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToEntry', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'vaultToEntry', inputs: [{ name: 'vaultId', type: 'uint256' }, { name: 'entryIdx', type: 'uint256' }], outputs: [{ name: '', type: 'bytes' }], stateMutability: 'view' },
  { type: 'function', name: 'getMachineHolder', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'setPayloadHolder', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'tokenURI', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' },
] as const

export const MACHINE_ABI = [
  { type: 'function', name: 'name', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToPayload', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'bytes' }], stateMutability: 'view' },
] as const

export type VesselType = 'capsule' | 'vault' | 'machine'

export function getGridDimensions(tokenId: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(tokenId))
  const rows = Math.ceil(tokenId / cols)
  return { cols, rows }
}

/** Render grayscale pixel data to a data URL (mode 0) */
export function renderPixels(data: Uint8Array, tokenId: number): string {
  const { cols, rows } = getGridDimensions(tokenId)
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(cols, rows)

  for (let i = 0; i < cols * rows; i++) {
    const v = i < data.length ? data[i] : 0
    const off = i * 4
    img.data[off] = v
    img.data[off + 1] = v
    img.data[off + 2] = v
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
