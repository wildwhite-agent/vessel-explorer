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

type SequenceMediaSlot = 'image' | 'animation'

export interface SequenceMediaAssetInfo {
  url: string
  mime: string
  kind: 'html' | 'video' | 'audio' | 'svg' | 'image' | 'unknown'
  bytes: number | null
}

export interface SequenceMediaMetadata {
  name: string
  description: string
  imageUri: string
  animationUri: string
}

interface LoadedBytes {
  bytes: Uint8Array
  mime: string
}

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

export async function loadSequenceMetadata(event: H3Event, id: string) {
  const metadataUri = await getClient(event).readContract({
    address: SEQUENCE_ADDRESS,
    abi: SEQUENCE_URI_ABI,
    functionName: 'uri',
    args: [BigInt(id)],
  }).catch(() => '')

  if (!metadataUri) {
    throw createError({ statusCode: 404, message: 'sequence metadata unavailable' })
  }

  const data = await loadBytes(metadataUri)
  const text = new TextDecoder().decode(data.bytes)
  let metadata: Record<string, unknown>
  try {
    metadata = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw createError({ statusCode: 502, message: 'invalid sequence metadata' })
  }

  return {
    name: stringValue(metadata.name),
    description: stringValue(metadata.description),
    imageUri: stringValue(metadata.image) || stringValue(metadata.image_url),
    animationUri: stringValue(metadata.animation_url) || stringValue(metadata.animation),
  } satisfies SequenceMediaMetadata
}

export async function loadSequenceMediaAsset(
  event: H3Event,
  id: string,
  slot: SequenceMediaSlot,
) {
  const metadata = await loadSequenceMetadata(event, id)
  const uri = slot === 'animation' ? metadata.animationUri : metadata.imageUri
  if (!uri) {
    throw createError({ statusCode: 404, message: `sequence ${slot} unavailable` })
  }

  const asset = await loadBytes(uri)
  return {
    bytes: asset.bytes,
    mime: detectMime(asset),
  }
}

export async function inspectSequenceMediaAsset(
  id: string,
  slot: SequenceMediaSlot,
  uri: string,
) {
  const asset = await inspectBytes(uri)
  const mime = detectMime(asset)
  return {
    url: `/api/sequence-media/${id}/${slot}`,
    mime,
    kind: mediaKindForMime(mime),
    bytes: asset.bytes.length || null,
  } satisfies SequenceMediaAssetInfo
}

export function mediaKindForMime(mime: string): SequenceMediaAssetInfo['kind'] {
  const normalized = mime.toLowerCase()
  if (normalized.includes('html')) return 'html'
  if (normalized === 'image/svg+xml' || normalized.includes('svg')) return 'svg'
  if (normalized.startsWith('video/')) return 'video'
  if (normalized.startsWith('audio/')) return 'audio'
  if (normalized.startsWith('image/')) return 'image'
  return 'unknown'
}

export async function loadBytes(uri: string): Promise<LoadedBytes> {
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

async function inspectBytes(uri: string): Promise<LoadedBytes> {
  const normalized = normalizeUri(uri)
  if (normalized.startsWith('data:')) return decodeDataUri(normalized)

  const head = await fetch(normalized, { method: 'HEAD' }).catch(() => null)
  if (head?.ok) {
    return {
      bytes: new Uint8Array(),
      mime: head.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream',
    }
  }

  return await loadBytes(uri)
}

function decodeDataUri(uri: string): LoadedBytes {
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
  if (uri.startsWith('ar://')) {
    return `https://arweave.net/${uri.slice('ar://'.length)}`
  }
  return uri
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function detectMime(asset: LoadedBytes) {
  return sniffAssetMime(asset.bytes) || asset.mime || 'application/octet-stream'
}

function looksLikeText(bytes: Uint8Array, pattern: RegExp) {
  const prefix = new TextDecoder().decode(bytes.slice(0, 512)).trimStart()
  return pattern.test(prefix)
}

function sniffAssetMime(bytes: Uint8Array) {
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
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
    return 'video/webm'
  }
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'video/mp4'
  }
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'audio/mpeg'
  }
  if (bytes[0] === 0xFF && ((bytes[1] ?? 0) & 0xE0) === 0xE0) {
    return 'audio/mpeg'
  }
  if (looksLikeText(bytes, /^<svg[\s>]|^<\?xml/i)) {
    return 'image/svg+xml'
  }
  if (looksLikeText(bytes, /^<!doctype html|^<html[\s>]/i)) {
    return 'text/html'
  }
  return ''
}
