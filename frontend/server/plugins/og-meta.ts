export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const url = getRequestURL(event)
    const origin = url.origin
    const path = url.pathname

    let title = 'vessel explorer'
    let description = 'explore THE_VESSEL on-chain storage protocol on ethereum'
    let image = ''
    let card = 'summary'

    // Vessel detail page: /<number>
    const vesselMatch = path.match(/^\/(\d+)$/)
    if (vesselMatch) {
      const id = vesselMatch[1]
      title = `vessel #${id}`
      description = `vessel #${id} on THE_VESSEL — on-chain storage protocol on ethereum`
      image = `${origin}/api/og/${id}`
      card = 'summary_large_image'
    }

    // Address page: /address/<addr>
    const addrMatch = path.match(/^\/address\/(.+)$/)
    if (addrMatch) {
      const addr = addrMatch[1]!
      const short = addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr
      title = `${short} — vessel explorer`
      description = `vessels owned by ${short}`
    }

    // Grid page
    if (path === '/grid') {
      title = 'all vessels'
      description = 'browse all 10,000 vessels on THE_VESSEL'
    }

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

    const tags = [
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:url" content="${origin}${path}" />`,
      `<meta name="twitter:title" content="${esc(title)}" />`,
      `<meta name="twitter:description" content="${esc(description)}" />`,
    ]

    if (image) {
      tags.push(
        `<meta property="og:image" content="${image}" />`,
        `<meta property="og:image:type" content="image/png" />`,
        `<meta name="twitter:card" content="${card}" />`,
        `<meta name="twitter:image" content="${image}" />`,
      )
    } else {
      tags.push(`<meta name="twitter:card" content="${card}" />`)
    }

    html.head.push(tags.join('\n'))
  })
})
