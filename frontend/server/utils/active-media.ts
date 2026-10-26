import { gunzipSync } from 'node:zlib'
import { createError } from 'h3'
import { MAX_ASSET_BYTES } from './media-limits.ts'

export const ARTWORK_CSP = [
  'sandbox allow-scripts allow-pointer-lock',
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob: https://ipfs.io https://arweave.net',
  'media-src data: blob: https://ipfs.io https://arweave.net',
  'font-src data:',
  'connect-src https://ethereum-rpc.publicnode.com https://eth.llamarpc.com https://cloudflare-eth.com',
  'worker-src blob:',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function normalizeCompressedHtmlScripts(media: { bytes: Uint8Array; mime: string }) {
  if (media.mime !== 'text/html') return media
  if (media.bytes.byteLength > MAX_ASSET_BYTES) throw createError({ statusCode: 502, message: 'artwork too large' })
  const html = new TextDecoder().decode(media.bytes)
  const lower = html.toLowerCase()
  let cursor = 0
  let expanded = 0
  let count = 0
  let outputBytes = media.bytes.byteLength
  const parts: string[] = []
  while (cursor < html.length) {
    const start = lower.indexOf('<script', cursor)
    if (start === -1) break
    const end = lower.indexOf('>', start)
    if (end === -1) break
    const tag = html.slice(start, end + 1)
    const type = /\btype\s*=\s*["']text\/javascript\+gzip["']/i.exec(tag)
    const src = /\bsrc\s*=\s*["']data:text\/javascript;base64,([A-Za-z0-9+/=]+)["']/i.exec(tag)
    parts.push(html.slice(cursor, start))
    if (type && src) {
      if (++count > 16 || expanded >= 4 * 1024 * 1024) throw createError({ statusCode: 502, message: 'compressed artwork limit exceeded' })
      let script: Buffer
      try {
        script = gunzipSync(Buffer.from(src[1]!, 'base64'), { maxOutputLength: Math.min(1024 * 1024, 4 * 1024 * 1024 - expanded) })
      } catch { throw createError({ statusCode: 502, message: 'invalid compressed artwork' }) }
      expanded += script.length
      const replacement = tag.replace(type[0], 'type="text/javascript"').replace(src[0], `src="data:text/javascript;base64,${script.toString('base64')}"`)
      outputBytes += Buffer.byteLength(replacement) - Buffer.byteLength(tag)
      if (outputBytes > MAX_ASSET_BYTES) throw createError({ statusCode: 502, message: 'expanded artwork too large' })
      parts.push(replacement)
    } else {
      parts.push(tag)
    }
    cursor = end + 1
  }
  parts.push(html.slice(cursor))
  return { bytes: Buffer.from(parts.join('')), mime: media.mime }
}
