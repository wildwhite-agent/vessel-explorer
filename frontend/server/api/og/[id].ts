import { requireVesselId, boundedPngDimensions } from '../../utils/media-limits.ts'
import { BoundedWorkCache, admitMediaRequest } from '../../utils/bounded-work.ts'
import { deflateSync } from 'node:zlib'
import { assertMethod, defineEventHandler, getRouterParam, createError, setResponseHeaders, type H3Event } from 'h3'
import { createPublicClient, http, type Hex } from 'viem'
import { mainnet } from 'viem/chains'

const VESSEL_ADDRESS = '0xECb92Cc7112b80A2234936315BbB493fb48d1463'
const VESSEL_PAYLOAD_ABI = [
  {
    type: 'function',
    name: 'craftToPayload',
    inputs: [{ name: '_tokenId', type: 'uint256' }],
    outputs: [{ name: 'payload', type: 'bytes' }],
    stateMutability: 'view',
  },
] as const

let clientRpcUrl = ''
let client: ReturnType<typeof createPublicClient> | null = null
let emptyCraftImage: Uint8Array | null | undefined

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

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (!clean || clean.length % 2 !== 0) return new Uint8Array(0)
  if (clean.length > 20_000 || !/^[a-fA-F0-9]*$/.test(clean)) {
    throw createError({ statusCode: 502, message: 'invalid vessel payload' })
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function buildPng(pixels: Uint8Array, width: number, height: number, scale: number, colorMode: number = 0): Buffer {
  const { w, h } = boundedPngDimensions(width, height, scale)

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

function machineRpcUrl(event: H3Event) {
  const config = useRuntimeConfig(event)
  const publicConfig = config.public as {
    machineRpcUrl?: unknown
    evm?: { chains?: { mainnet?: { rpcs?: unknown } } }
  }
  return String(
    publicConfig.machineRpcUrl
      || publicConfig.evm?.chains?.mainnet?.rpcs
      || 'https://ethereum-rpc.publicnode.com',
  )
}

function getClient(event: H3Event) {
  const rpcUrl = machineRpcUrl(event)
  if (!client || clientRpcUrl !== rpcUrl) {
    clientRpcUrl = rpcUrl
    client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })
  }
  return client
}

async function liveMachinePayload(event: H3Event, tokenId: number) {
  const payload = await getClient(event).readContract({
    address: VESSEL_ADDRESS,
    abi: VESSEL_PAYLOAD_ABI,
    functionName: 'craftToPayload',
    args: [BigInt(tokenId)],
  }).catch(() => null)

  return typeof payload === 'string' ? payload as Hex : null
}

async function claimedEmptyCraftImage() {
  if (emptyCraftImage !== undefined) return emptyCraftImage

  const raw = await useStorage('assets:server')
    .getItemRaw('claimed-empty-craft.jpg')
    .catch(() => null)

  if (raw == null) {
    emptyCraftImage = null
  } else if (typeof raw === 'string') {
    emptyCraftImage = Buffer.from(raw)
  } else if (raw instanceof ArrayBuffer) {
    emptyCraftImage = new Uint8Array(raw)
  } else {
    emptyCraftImage = raw
  }

  return emptyCraftImage
}

const previews = new BoundedWorkCache<{ bytes: Uint8Array; mime: string; maxAge: number }>(4, 64, 16 * 1024 * 1024)

export default defineEventHandler(async (event) => {
  assertMethod(event, ['GET', 'HEAD'])
  const tokenId = requireVesselId(getRouterParam(event, 'id'))
  admitMediaRequest(event)
  const image = await previews.get(String(tokenId), async () => {
    // Resolve the token before dimensions, payload decoding, or image allocation.
    const token = await fetchIndexerJson(`/tokens/${tokenId}`)
    if (!token || Number(token.id) !== tokenId) {
      throw createError({ statusCode: 404, message: 'vessel not found' })
    }
    const { cols, rows } = getGridDimensions(tokenId)
    const scale = Math.max(1, Math.floor(400 / cols))
    const livePayload = token.isMachine ? await liveMachinePayload(event, tokenId) : null
    const pixels = hexToBytes(String(livePayload || token.payloadHex || '0x'))
    const maxAge = token.isMachine ? 60 : 3600
    if (pixels.length === 0) {
      const bytes = await claimedEmptyCraftImage()
      if (bytes) return { bytes, mime: 'image/jpeg', maxAge }
    }
    return {
      bytes: buildPng(pixels, cols, rows, scale, Number(token.colorMode || 0)),
      mime: 'image/png',
      maxAge,
    }
  }, 60_000, image => image.bytes.byteLength)
  setResponseHeaders(event, {
    'Content-Type': image.mime,
    'Content-Length': image.bytes.byteLength,
    'Cache-Control': `public, max-age=${image.maxAge}`,
    'X-Content-Type-Options': 'nosniff',
  })
  return image.bytes
})
