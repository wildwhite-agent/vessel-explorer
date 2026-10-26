import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener, defineEventHandler } from 'h3'
import { chromium } from '@playwright/test'
import handler from '../../server/api/sequence-media/[id]/[asset].get.ts'

let artworkOrigin = ''
let assetLoader: (() => Promise<{ mime: string; bytes: Buffer }>) | undefined
Object.assign(globalThis, {
  useRuntimeConfig: () => ({ public: { artworkOrigin } }),
  loadSequenceMediaAsset: async () => assetLoader ? assetLoader() : ({ mime: 'text/html', bytes: Buffer.from(`<!doctype html><script>
    window.result = {};
    try { window.result.cookie = document.cookie; } catch { window.result.cookieBlocked = true; }
    try { localStorage.setItem('artwork', 'no'); } catch { window.result.storageBlocked = true; }
    window.result.origin = window.origin;
    fetch('/private').then(() => window.result.fetchBlocked = false).catch(() => window.result.fetchBlocked = true);
  </script><p>Sandbox fixture</p>`) }),
})

test('direct artwork navigation has an opaque origin and cannot access app storage or fetch app endpoints', async () => {
  let privateRequests = 0
  const app = createApp().use(createRouter()
    .get('/api/sequence-media/:id/:asset', handler)
    .get('/private', defineEventHandler(() => { privateRequests++; return 'must not be fetched' })))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
    const context = await browser.newContext()
    await context.addCookies([{ name: 'app-test-cookie', value: 'private', url: origin }])
    const page = await context.newPage()
    const response = await page.goto(`${origin}/api/sequence-media/1/image`)
    assert.equal(response!.status(), 200)
    assert.match(response!.headers()['content-security-policy']!, /^sandbox allow-scripts allow-pointer-lock;/)
    await page.waitForFunction(() => (window as any).result?.fetchBlocked === true)
    const result = await page.evaluate(() => (window as any).result)
    assert.equal(result.origin, 'null')
    assert.equal(result.cookieBlocked, true)
    assert.equal(result.storageBlocked, true)
    assert.equal(privateRequests, 0)
    // Configured production artwork URLs redirect to the separate origin.
    artworkOrigin = 'https://artwork.example.org'
    const redirect = await fetch(`${origin}/api/sequence-media/1/image?v=123-456-7&view=2&ignored=1`, { redirect: 'manual' })
    assert.equal(redirect.status, 307)
    assert.equal(redirect.headers.get('location'), 'https://artwork.example.org/api/sequence-media/1/image?v=123-456-7&view=2')
    assert.equal((await fetch(`${origin}/api/sequence-media/1/image?v=a&v=b`, { redirect: 'manual' })).status, 400)
  } finally {
    await browser?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})


test('a gallery burst waits within a bounded queue and loads all twelve images', async () => {
  artworkOrigin = ''
  let active = 0
  let peak = 0
  let loads = 0
  assetLoader = async () => {
    peak = Math.max(peak, ++active)
    loads++
    await new Promise(resolve => setTimeout(resolve, 120))
    active--
    return { mime: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=', 'base64') }
  }
  const app = createApp().use(createRouter().get('/api/sequence-media/:id/:asset', handler))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
    const page = await browser.newPage()
    const failures: number[] = []
    page.on('response', response => { if (response.status() !== 200) failures.push(response.status()) })
    await page.setContent(Array.from({ length: 12 }, (_, i) => `<img src="http://127.0.0.1:${port}/api/sequence-media/${i + 100}/image">`).join(''))
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))
    assert.equal(loads, 12)
    assert.equal(peak, 4)
    assert.deepEqual(failures, [])
  } finally {
    await browser?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    assetLoader = undefined
  }
})
