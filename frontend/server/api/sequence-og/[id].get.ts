import { Resvg } from '@resvg/resvg-js'
import type { H3Event } from 'h3'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const SEQUENCE_ADDRESS = '0x9423548a957284eD17E55c37c4B6D96e5E63065f'
const SEQUENCE_URI_ABI = [
  {
    type: 'function',
    name: 'uri',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const

let clientRpcUrl = ''
let client: ReturnType<typeof createPublicClient> | null = null

function rpcUrl(event: H3Event) {
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
  const url = rpcUrl(event)
  if (!client || clientRpcUrl !== url) {
    clientRpcUrl = url
    client = createPublicClient({
      chain: mainnet,
      transport: http(url),
    })
  }
  return client
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, message: 'invalid sequence id' })
  }

  const metadataUri = await getClient(event).readContract({
    address: SEQUENCE_ADDRESS,
    abi: SEQUENCE_URI_ABI,
    functionName: 'uri',
    args: [BigInt(id)],
  }).catch(() => '')

  if (!metadataUri) {
    throw createError({ statusCode: 404, message: 'sequence metadata unavailable' })
  }

  const metadata = await loadJson(metadataUri)
  const imageUri = stringValue(metadata.image) || stringValue(metadata.image_url)
  if (!imageUri) {
    throw createError({ statusCode: 404, message: 'sequence image unavailable' })
  }

  const image = await loadBytes(imageUri)
  const imageMime = sniffImageMime(image.bytes) || image.mime
  const rendered = imageMime.includes('svg') || looksLikeSvg(image.bytes)
    ? {
        bytes: new Resvg(Buffer.from(image.bytes), {
          fitTo: { mode: 'width', value: 1200 },
        }).render().asPng(),
        mime: 'image/png',
      }
    : { ...image, mime: imageMime }

  setResponseHeaders(event, {
    'Content-Type': rendered.mime,
    'Cache-Control': 'public, max-age=3600',
  })

  return rendered.bytes
})

async function loadJson(uri: string) {
  const data = await loadBytes(uri)
  const text = new TextDecoder().decode(data.bytes)
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw createError({ statusCode: 502, message: 'invalid sequence metadata' })
  }
}

async function loadBytes(uri: string) {
  const normalized = normalizeUri(uri)
  if (normalized.startsWith('data:')) return decodeDataUri(normalized)

  const response = await fetch(normalized).catch(() => null)
  if (!response?.ok) {
    throw createError({ statusCode: 502, message: 'sequence asset request failed' })
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mime: response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream',
  }
}

function decodeDataUri(uri: string) {
  const match = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!match) {
    throw createError({ statusCode: 502, message: 'invalid sequence data uri' })
  }

  const mime = match[1] || 'application/octet-stream'
  const encoded = match[3] || ''
  const bytes = match[2]
    ? Buffer.from(encoded, 'base64')
    : Buffer.from(decodeURIComponent(encoded))

  return { bytes: new Uint8Array(bytes), mime }
}

function normalizeUri(uri: string) {
  if (uri.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${uri.slice('ipfs://'.length)}`
  }
  return uri
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function looksLikeSvg(bytes: Uint8Array) {
  const prefix = new TextDecoder().decode(bytes.slice(0, 256)).trimStart()
  return prefix.startsWith('<svg') || prefix.startsWith('<?xml')
}

function sniffImageMime(bytes: Uint8Array) {
  if (
    bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4E
    && bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }
  if (
    bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
  ) {
    return 'image/gif'
  }
  if (
    bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return ''
}
