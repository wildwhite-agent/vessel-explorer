import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { deflateSync } from 'node:zlib'

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

const craftToColorModeAbi = [{
  name: 'craftToColorMode',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'uint8' }],
}] as const

function getGridDimensions(tokenId: number) {
  const cols = Math.ceil(Math.sqrt(tokenId))
  const rows = Math.ceil(tokenId / cols)
  return { cols, rows }
}

// CRC32 lookup table
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  }
  crcTable[n] = c >>> 0
}

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]!) & 0xFF]! ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}

function byteToRGB(v: number, mode: number): [number, number, number] {
  switch (mode) {
    case 1: return [v, 0, 0]
    case 2: return [0, v, 0]
    case 3: return [0, 0, v]
    default: return [v, v, v]
  }
}

function buildPng(pixels: Uint8Array, width: number, height: number, scale: number, colorMode: number = 0): Buffer {
  const w = width * scale
  const h = height * scale

  // Raw scanlines: filter byte (0 = None) + RGB per pixel
  const stride = 1 + w * 3
  const raw = Buffer.alloc(h * stride)

  for (let y = 0; y < h; y++) {
    const srcY = Math.floor(y / scale)
    const off = y * stride
    raw[off] = 0 // filter: None
    for (let x = 0; x < w; x++) {
      const srcX = Math.floor(x / scale)
      const srcIdx = srcY * width + srcX
      const v = srcIdx < pixels.length ? pixels[srcIdx]! : 0
      const [r, g, b] = byteToRGB(v, colorMode)
      const px = off + 1 + x * 3
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
    }
  }

  const compressed = deflateSync(raw)

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR: width, height, bit depth 8, color type 2 (RGB)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // color type: RGB
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
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
    const [payload, colorMode] = await Promise.all([
      client.readContract({
        address: VESSEL_ADDRESS,
        abi: craftToPayloadAbi,
        functionName: 'craftToPayload',
        args: [BigInt(tokenId)],
      }),
      client.readContract({
        address: VESSEL_ADDRESS,
        abi: craftToColorModeAbi,
        functionName: 'craftToColorMode',
        args: [BigInt(tokenId)],
      }).catch(() => 0),
    ])

    const hex = (payload as string).startsWith('0x') ? (payload as string).slice(2) : payload as string
    const pixels = new Uint8Array(hex.length / 2)
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
    }

    const png = buildPng(pixels, cols, rows, scale, Number(colorMode))

    setResponseHeaders(event, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    })

    return png
  } catch {
    // Empty vessel — return black image
    const pixels = new Uint8Array(cols * rows)
    const png = buildPng(pixels, cols, rows, scale)

    setResponseHeaders(event, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300',
    })

    return png
  }
})
