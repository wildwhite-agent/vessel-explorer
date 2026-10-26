import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { createHash } from 'node:crypto'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import ipaddr from 'ipaddr.js'
import { createError } from 'h3'
import { MAX_ASSET_BYTES } from './media-limits.ts'
import { BoundedWorkCache } from './bounded-work.ts'

export interface LoadedBytes { bytes: Uint8Array; mime: string }
const downloads = new BoundedWorkCache<LoadedBytes>(4, 32, 32 * 1024 * 1024, 8)
const DEFAULT_HOSTS = ['ipfs.io', 'arweave.net']
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const fail = () => createError({ statusCode: 502, message: 'sequence asset request rejected' })

export function mediaHosts(): string[] {
  return [...DEFAULT_HOSTS, ...(process.env.SEQUENCE_ASSET_HOSTS || '').split(',')]
    .map(host => host.trim().toLowerCase()).filter(Boolean)
}

export function normalizeMediaUri(uri: string) {
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7).replace(/^ipfs\//, '')}`
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice(5)}`
  return uri
}

export function validateMediaUrl(uri: string, hosts = mediaHosts()): URL {
  if (uri.length > 8192) throw fail()
  let url: URL
  try { url = new URL(normalizeMediaUri(uri)) } catch { throw fail() }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname.toLowerCase())) {
    throw fail()
  }
  return url
}

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address)
    // Reject mapped IPv4, transition, private, link-local, multicast and reserved ranges.
    if (parsed.range() !== 'unicast') return false
    if (parsed.kind() === 'ipv6' && !parsed.match(ipaddr.parse('2000::'), 3)) return false
    return true
  } catch { return false }
}

export async function resolvePublicAddress(hostname: string, resolver = lookup) {
  const addresses = await resolver(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(value => !isPublicAddress(value.address))) throw fail()
  return addresses[0]!
}

export function decodeMediaDataUri(uri: string, limit = MAX_ASSET_BYTES): LoadedBytes {
  // Check before regex/decoding; percent encoding can expand to three characters per byte.
  if (uri.length > limit * 3 + 256) throw fail()
  const comma = uri.indexOf(',')
  if (comma < 5 || comma > 255) throw fail()
  const header = uri.slice(0, comma)
  if (!/^data:([\w.+-]+\/[\w.+-]+)?(;base64)?$/i.test(header)) throw fail()
  const encoded = uri.slice(comma + 1)
  let bytes: Buffer
  try {
    if (header.toLowerCase().endsWith(';base64')) {
      if (encoded.length > Math.ceil(limit / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw fail()
      bytes = Buffer.from(encoded, 'base64')
    } else {
      bytes = Buffer.from(decodeURIComponent(encoded))
    }
  } catch { throw fail() }
  if (bytes.length > limit) throw fail()
  return { bytes, mime: header.slice(5).split(';')[0] || 'application/octet-stream' }
}

export async function collectBounded(stream: AsyncIterable<Uint8Array>, limit: number): Promise<Buffer> {
  let total = 0
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) {
    total += chunk.byteLength
    // A byte cap alone does not bound the overhead of millions of tiny chunks.
    if (total > limit || chunks.length >= 1024) throw fail()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total)
}

export function decodeMediaBody(bytes: Buffer, encoding: string, limit: number): Buffer {
  try {
    const options = { maxOutputLength: limit }
    switch (encoding.toLowerCase()) {
      case '': case 'identity': return bytes
      case 'gzip': return gunzipSync(bytes, options)
      case 'deflate': return inflateSync(bytes, options)
      case 'br': return brotliDecompressSync(bytes, options)
      default: throw fail()
    }
  } catch { throw fail() }
}

function openPinned(url: URL, address: { address: string; family: number }, signal: AbortSignal) {
  return new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request(url, {
      agent: false,
      family: address.family,
      signal,
      headers: { Accept: '*/*', 'Accept-Encoding': 'identity' },
      maxHeaderSize: 8192,
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    }, resolve)
    req.on('error', reject)
    req.end()
  })
}

const networkIO = { resolve: resolvePublicAddress, open: openPinned, timeoutMs: 10_000 }

export async function fetchMediaHttps(initial: URL, limit: number, io = networkIO): Promise<LoadedBytes> {
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), io.timeoutMs)
  const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(fail()), { once: true }))
  const run = async () => {
    let url = initial
    for (let redirect = 0; redirect <= 3; redirect++) {
      // Resolve every hop. The lookup callback below pins this exact address to
      // the socket, preserving the original hostname for Host and TLS/SNI.
      const address = await io.resolve(url.hostname)
      controller.signal.throwIfAborted()
      const response = await io.open(url, address, controller.signal)
      try {
        if (REDIRECTS.has(response.statusCode || 0)) {
          if (redirect === 3 || !response.headers.location) throw fail()
          url = validateMediaUrl(new URL(response.headers.location, url).toString())
          continue
        }
        if (response.statusCode !== 200) throw fail()
        const length = response.headers['content-length']
        if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw fail()
        const raw = await collectBounded(response, limit)
        const bytes = decodeMediaBody(raw, response.headers['content-encoding'] || '', limit)
        return { bytes, mime: response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream' }
      } finally { response.destroy() }
    }
    throw fail()
  }
  try { return await Promise.race([run(), aborted]) } catch { throw fail() } finally {
    clearTimeout(deadline)
    controller.abort()
  }
}

export async function loadSafeMediaBytes(uri: string, limit = MAX_ASSET_BYTES, revisionKey = 'current'): Promise<LoadedBytes> {
  if (uri.startsWith('data:')) return decodeMediaDataUri(uri, limit)
  const url = validateMediaUrl(uri)
  const key = `${revisionKey}:${limit}:${createHash('sha256').update(url.href).digest('hex')}`
  return downloads.get(key, () => fetchMediaHttps(url, limit), 60_000, value => value.bytes.byteLength)
}
