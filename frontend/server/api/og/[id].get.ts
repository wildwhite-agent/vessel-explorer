import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const VESSEL_ADDRESS = '0xECb92Cc7112b80A2234936315BbB493fb48d1463' as const

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com'),
})

const craftToPayloadAbi = [{
  name: 'craftToPayload',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'bytes' }],
}] as const

function getGridDimensions(tokenId: number) {
  const cols = Math.ceil(Math.sqrt(tokenId))
  const rows = Math.ceil(tokenId / cols)
  return { cols, rows }
}

function buildBmp(pixels: Uint8Array, width: number, height: number, scale: number): Buffer {
  const w = width * scale
  const h = height * scale
  const rowSize = Math.ceil(w / 4) * 4 // rows padded to 4 bytes
  const paletteSize = 256 * 4
  const pixelDataSize = rowSize * h
  const headerSize = 14 + 40 + paletteSize
  const fileSize = headerSize + pixelDataSize

  const buf = Buffer.alloc(fileSize)

  // File header (14 bytes)
  buf.write('BM', 0)
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt32LE(0, 6) // reserved
  buf.writeUInt32LE(headerSize, 10) // pixel data offset

  // Info header (40 bytes)
  buf.writeUInt32LE(40, 14) // header size
  buf.writeInt32LE(w, 18) // width
  buf.writeInt32LE(h, 22) // height (positive = bottom-up)
  buf.writeUInt16LE(1, 26) // planes
  buf.writeUInt16LE(8, 28) // bits per pixel
  buf.writeUInt32LE(0, 30) // compression (none)
  buf.writeUInt32LE(pixelDataSize, 34)
  buf.writeInt32LE(2835, 38) // x ppi
  buf.writeInt32LE(2835, 42) // y ppi
  buf.writeUInt32LE(256, 46) // colors used
  buf.writeUInt32LE(0, 50) // important colors

  // Grayscale palette
  for (let i = 0; i < 256; i++) {
    const off = 54 + i * 4
    buf[off] = i     // blue
    buf[off + 1] = i // green
    buf[off + 2] = i // red
    buf[off + 3] = 0 // reserved
  }

  // Pixel data (bottom-up, scaled)
  for (let y = 0; y < h; y++) {
    const srcY = height - 1 - Math.floor(y / scale) // BMP is bottom-up, flip
    const rowOffset = headerSize + y * rowSize
    for (let x = 0; x < w; x++) {
      const srcX = Math.floor(x / scale)
      const srcIdx = srcY * width + srcX
      buf[rowOffset + x] = srcIdx < pixels.length ? pixels[srcIdx] : 0
    }
  }

  return buf
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || isNaN(Number(id))) {
    throw createError({ statusCode: 400, message: 'invalid vessel id' })
  }

  const tokenId = Number(id)
  const { cols, rows } = getGridDimensions(tokenId)

  // Scale up for OG image (aim for ~400px wide)
  const scale = Math.max(1, Math.floor(400 / cols))

  try {
    const payload = await client.readContract({
      address: VESSEL_ADDRESS,
      abi: craftToPayloadAbi,
      functionName: 'craftToPayload',
      args: [BigInt(tokenId)],
    })

    const hex = (payload as string).startsWith('0x') ? (payload as string).slice(2) : payload as string
    const pixels = new Uint8Array(hex.length / 2)
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
    }

    const bmp = buildBmp(pixels, cols, rows, scale)

    setResponseHeaders(event, {
      'Content-Type': 'image/bmp',
      'Cache-Control': 'public, max-age=3600',
    })

    return bmp
  } catch {
    // Empty vessel — return black image
    const pixels = new Uint8Array(cols * rows)
    const bmp = buildBmp(pixels, cols, rows, scale)

    setResponseHeaders(event, {
      'Content-Type': 'image/bmp',
      'Cache-Control': 'public, max-age=300',
    })

    return bmp
  }
})
