export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const asset = getRouterParam(event, 'asset')
  if (!id || !/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, message: 'invalid sequence id' })
  }
  if (asset !== 'image' && asset !== 'animation') {
    throw createError({ statusCode: 400, message: 'invalid sequence asset' })
  }

  let media = await loadSequenceMediaAsset(event, id, asset)
  if (id === '7' && asset === 'animation' && media.mime === 'text/html') {
    media = patchSequence7AudioButton(media)
  }
  setResponseHeaders(event, {
    'Content-Type': media.mime,
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
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
