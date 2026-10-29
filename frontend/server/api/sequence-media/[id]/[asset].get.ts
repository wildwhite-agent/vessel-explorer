import { mediaRevisionKey } from '../../../utils/media-revision.ts'
import { defineEventHandler, getRouterParam, createError, getRequestURL, setResponseHeaders } from 'h3'
import { requireSequenceId } from '../../../utils/media-limits.ts'
import { ARTWORK_CSP, normalizeCompressedHtmlScripts } from '../../../utils/active-media.ts'
import { admitMediaRequest, BoundedWorkCache } from '../../../utils/bounded-work.ts'

const mediaCache = new BoundedWorkCache<{ bytes: Uint8Array; mime: string }>(4, 32, 32 * 1024 * 1024, 8)

export default defineEventHandler(async (event) => {
  const id = requireSequenceId(getRouterParam(event, 'id'))
  const asset = getRouterParam(event, 'asset')
  if (asset !== 'image' && asset !== 'animation') {
    throw createError({ statusCode: 400, message: 'invalid sequence asset' })
  }

  admitMediaRequest(event)
  const media = await mediaCache.get(`${id}:${asset}:${mediaRevisionKey(event)}`, async () => {
    let media = normalizeCompressedHtmlScripts(await loadSequenceMediaAsset(event, id, asset))
    if (id === '7' && asset === 'animation' && media.mime === 'text/html') {
      media = patchSequence7AudioButton(media)
    }
    return media
  }, 60_000, media => media.bytes.byteLength)
  // A browser's direct audio/video viewer reloads this same URL as media.
  // Permit only this asset path, while connect-src still denies the app origin.
  const directMedia = /^(audio|video)\//.test(media.mime)
  const csp = directMedia
    ? ARTWORK_CSP.replace('media-src ', `media-src ${getRequestURL(event).origin}/api/sequence-media/${id}/${asset} `)
    : ARTWORK_CSP
  setResponseHeaders(event, {
    'Content-Type': media.mime,
    ...(directMedia ? { 'Access-Control-Allow-Origin': '*' } : {}),
    'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    // Apply to every MIME, so mislabeled/polyglot artwork never acquires the app origin.
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Length': media.bytes.byteLength,
  })

  return media.bytes
})

function patchSequence7AudioButton(media: { bytes: Uint8Array; mime: string }) {
  const html = new TextDecoder().decode(media.bytes)
  if (!html.includes('id=audioPlay') || html.includes('vessel-sequence-7-play-fix')) return media

  const fix = [
    '<style id="vessel-sequence-7-play-fix">',
    '#audioPlay{top:50%;bottom:auto;transform:translate(-50%,-50%)}',
    '#audioPlay:hover{transform:translate(-50%,-50%) translateY(-1px)}',
    '#audioPlay:active{transform:translate(-50%,-50%) scale(0.98)}',
    '</style>',
  ].join('')
  const patched = html.includes('</head>')
    ? html.replace('</head>', `${fix}</head>`)
    : `${fix}${html}`

  return {
    bytes: new TextEncoder().encode(patched),
    mime: media.mime,
  }
}
