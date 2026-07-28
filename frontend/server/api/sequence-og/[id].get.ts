import { existsSync } from 'node:fs'
import { chromium, type Browser } from 'playwright-core'
import type { SequenceMediaAssetInfo } from '../../utils/sequence-media'

interface SequenceOgImage {
  bytes: Uint8Array
  mime: string
  cacheControl: string
}

const SOCIAL_IMAGE_WIDTH = 1200
const SOCIAL_IMAGE_HEIGHT = 630
const SEQUENCE_MEDIA_VIEW_VERSION = '2'
const RENDER_SETTLE_MS = 1400
const HTML_RENDER_SETTLE_MS = 5000
const CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean) as string[]

let browserPromise: Promise<Browser> | null = null

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, message: 'invalid sequence id' })
  }

  const image = await renderSequenceOgImage(event, id)
  setResponseHeaders(event, {
    'Content-Type': image.mime,
    'Cache-Control': image.cacheControl,
  })

  return image.bytes
})

async function renderSequenceOgImage(event: Parameters<typeof loadSequenceMetadata>[0], id: string): Promise<SequenceOgImage> {
  const origin = internalRenderOrigin(event)
  const metadata = await loadSequenceMetadata(event, id)
  const image = metadata.imageUri
    ? await inspectSequenceMediaAsset(event, id, 'image', metadata.imageUri).catch(() => null)
    : null

  if (!image) {
    throw createError({ statusCode: 404, message: 'sequence image unavailable' })
  }

  const mediaUrl = absoluteMediaUrl(origin, image.url)
  const bytes = image.kind === 'html'
    ? await screenshotUrl(mediaUrl, HTML_RENDER_SETTLE_MS)
    : await screenshotHtml(sequenceRenderHtml({
        title: metadata.name || `Sequence #${id}`,
        media: image,
        mediaUrl,
        posterUrl: mediaUrl,
      }))

  return {
    bytes,
    mime: 'image/png',
    cacheControl: 'public, max-age=300',
  }
}

function internalRenderOrigin(event: Parameters<typeof getRequestURL>[0]) {
  const port = process.env.PORT
  if (port) return `http://127.0.0.1:${port}`
  return getRequestURL(event).origin
}

function absoluteMediaUrl(origin: string, url: string) {
  const resolved = new URL(url, origin)
  resolved.searchParams.set('view', SEQUENCE_MEDIA_VIEW_VERSION)
  resolved.searchParams.set('og', '1')
  return resolved.toString()
}

function sequenceRenderHtml(options: {
  title: string
  media: SequenceMediaAssetInfo
  mediaUrl: string
  posterUrl: string
}) {
  const media = renderMediaElement(options.media, options.mediaUrl, options.posterUrl)
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${SOCIAL_IMAGE_WIDTH},height=${SOCIAL_IMAGE_HEIGHT},initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>
    html,
    body {
      width: ${SOCIAL_IMAGE_WIDTH}px;
      height: ${SOCIAL_IMAGE_HEIGHT}px;
      margin: 0;
      background: #000;
      overflow: hidden;
    }

    body {
      display: grid;
      place-items: center;
    }

    .stage {
      width: ${SOCIAL_IMAGE_WIDTH}px;
      height: ${SOCIAL_IMAGE_HEIGHT}px;
      display: grid;
      place-items: center;
      background: #000;
      overflow: hidden;
    }

    img,
    video,
    audio,
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
      background: #000;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <main class="stage">${media}</main>
  <script>
    window.__sequenceOgReady = false;

    async function settleMedia() {
      const img = document.querySelector('img');
      if (img && !img.complete) {
        await new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 1800);
        });
      }

      const video = document.querySelector('video');
      if (video) {
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => {});
        if (Number.isFinite(video.duration) && video.duration > 0.35) {
          video.currentTime = 0.25;
          await new Promise((resolve) => {
            video.addEventListener('seeked', resolve, { once: true });
            setTimeout(resolve, 1200);
          });
        }
      }

      const audio = document.querySelector('audio');
      if (audio) {
        await audio.play().catch(() => {});
      }

      const frame = document.querySelector('iframe');
      if (frame) {
        await new Promise((resolve) => {
          frame.addEventListener('load', resolve, { once: true });
          setTimeout(resolve, 1800);
        });
      }

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.__sequenceOgReady = true;
    }

    settleMedia().catch(() => {
      window.__sequenceOgReady = true;
    });
  </script>
</body>
</html>`
}

function renderMediaElement(media: SequenceMediaAssetInfo, mediaUrl: string, posterUrl: string) {
  const src = escapeHtml(mediaUrl)
  const poster = posterUrl ? ` poster="${escapeHtml(posterUrl)}"` : ''

  if (media.kind === 'video') {
    return `<video src="${src}"${poster} autoplay muted playsinline preload="auto"></video>`
  }

  if (media.kind === 'audio') {
    return posterUrl
      ? `<img src="${escapeHtml(posterUrl)}" alt="">`
      : `<audio src="${src}" controls preload="metadata"></audio>`
  }

  if (media.kind === 'html' || media.kind === 'svg') {
    return `<iframe src="${src}" title="Sequence media"></iframe>`
  }

  return `<img src="${src}" alt="">`
}

async function screenshotUrl(url: string, settleMs: number) {
  const browser = await getBrowser()
  const page = await browser.newPage({
    viewport: {
      width: SOCIAL_IMAGE_WIDTH,
      height: SOCIAL_IMAGE_HEIGHT,
    },
    deviceScaleFactor: 1,
  })

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 15_000 })
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => null)
    await page.waitForTimeout(settleMs)
    return await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: SOCIAL_IMAGE_WIDTH,
        height: SOCIAL_IMAGE_HEIGHT,
      },
    })
  } finally {
    await page.close().catch(() => null)
  }
}

async function screenshotHtml(html: string) {
  const browser = await getBrowser()
  const page = await browser.newPage({
    viewport: {
      width: SOCIAL_IMAGE_WIDTH,
      height: SOCIAL_IMAGE_HEIGHT,
    },
    deviceScaleFactor: 1,
  })

  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 15_000 })
    await page.waitForFunction(() => Boolean((window as any).__sequenceOgReady), null, {
      timeout: 4_000,
    }).catch(() => null)
    await page.waitForTimeout(RENDER_SETTLE_MS)
    return await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: SOCIAL_IMAGE_WIDTH,
        height: SOCIAL_IMAGE_HEIGHT,
      },
    })
  } finally {
    await page.close().catch(() => null)
  }
}

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      executablePath: chromiumExecutablePath(),
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-swiftshader',
        '--use-angle=swiftshader',
      ],
    }).catch((error) => {
      browserPromise = null
      throw error
    })
  }
  return browserPromise
}

function chromiumExecutablePath() {
  const candidate = CHROMIUM_CANDIDATES.find((path) => existsSync(path))
  return candidate || chromium.executablePath()
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
