import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener, toWebHandler, defineEventHandler } from 'h3'
import { chromium } from '@playwright/test'
import handler from '../../server/api/sequence-media/[id]/[asset].get.ts'

let assetLoader: (() => Promise<{ mime: string; bytes: Buffer }>) | undefined
Object.assign(globalThis, {
  loadSequenceMediaAsset: async () => assetLoader ? assetLoader() : ({ mime: 'text/html', bytes: Buffer.from(`<!doctype html><script>
    window.result = {};
    try { window.result.cookie = document.cookie; } catch { window.result.cookieBlocked = true; }
    try { localStorage.setItem('artwork', 'no'); } catch { window.result.storageBlocked = true; }
    window.result.origin = window.origin;
    fetch('/private').then(() => window.result.fetchBlocked = false).catch(() => window.result.fetchBlocked = true);
  </script><p>Sandbox fixture</p>`) }),
})

test('sequence media refreshes for a new notification revision and reuses an identical revision', async () => {
  let loads = 0
  assetLoader = async () => ({ mime: 'image/png', bytes: Buffer.from(`fixture-${++loads}`) })
  const request = toWebHandler(createApp().use(createRouter().get('/api/sequence-media/:id/:asset', handler)))
  const url = 'http://localhost/api/sequence-media/200/image?v='
  try {
    assert.equal(await (await request(new Request(url + '123-0xabc-7%3A4%2C8%3A1-456'))).text(), 'fixture-1')
    assert.equal(await (await request(new Request(url + '124-0xabc-7%3A4%2C8%3A1-457'))).text(), 'fixture-2')
    assert.equal(await (await request(new Request(url + '124-0xabc-7%3A4%2C8%3A1-457'))).text(), 'fixture-2')
    assert.equal(loads, 2)
  } finally { assetLoader = undefined }
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
    assert.equal((await fetch(`${origin}/api/sequence-media/1/image?v=a&v=b`, { redirect: 'manual' })).status, 400)
  } finally {
    await browser?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})


test('a gallery burst waits within a bounded queue and loads all twelve images', async () => {
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

test('embedded styles and audio data work while artwork libraries stay restricted to the pinned URL', async () => {
  const library = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js'
  assetLoader = async () => ({ mime: 'text/html', bytes: Buffer.from(`<!doctype html>
    <link rel="stylesheet" href="data:text/css,body%7Bbackground-color%3Argb(1%2C2%2C3)%7D">
    <script src="${library}"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.1/p5.min.js"></script>
    <script>fetch('data:text/plain;base64,b2s=').then(r => r.text()).then(value => window.dataResult = value);</script>
    <p>Embedded media fixture</p>`) })
  const app = createApp().use(createRouter().get('/api/sequence-media/:id/:asset', handler))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const requests: string[] = []
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
    const page = await browser.newPage()
    await page.route('https://cdnjs.cloudflare.com/**', async route => {
      requests.push(route.request().url())
      await route.fulfill({ contentType: 'application/javascript', body: 'window.libraryLoaded = true' })
    })
    await page.goto(`http://127.0.0.1:${port}/api/sequence-media/202/animation`)
    await page.waitForFunction(() => (window as any).dataResult === 'ok' && (window as any).libraryLoaded, {}, { timeout: 5000 })
    assert.deepEqual(requests, [library])
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(1, 2, 3)')
    assert.equal(await page.evaluate(() => window.origin), 'null')
    assert.equal(await page.evaluate(() => { try { localStorage.getItem('x'); return false } catch { return true } }), true)
  } finally {
    await browser?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    assetLoader = undefined
  }
})


test('direct audio playback loads only its media path and still denies app requests and storage', async () => {
  const samples = 8000
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(samples, 24); wav.writeUInt32LE(samples * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  assetLoader = async () => ({ mime: 'audio/wav', bytes: wav })
  let privateRequests = 0
  const app = createApp().use(createRouter()
    .get('/api/sequence-media/:id/:asset', handler)
    .get('/private', defineEventHandler(() => { privateRequests++; return 'private' })))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${port}/api/sequence-media/203/animation`)
    await page.waitForFunction(() => document.querySelector('video, audio') instanceof HTMLMediaElement
      && (document.querySelector('video, audio') as HTMLMediaElement).readyState >= 2, {}, { timeout: 5000 })
    await page.evaluate(async () => { const media = document.querySelector('video, audio') as HTMLMediaElement; media.muted = true; await media.play() })
    await page.waitForFunction(() => (document.querySelector('video, audio') as HTMLMediaElement).currentTime > 0)
    assert.equal(await page.evaluate(() => window.origin), 'null')
    assert.equal(await page.evaluate(() => { try { localStorage.getItem('x'); return false } catch { return true } }), true)
    assert.equal(await page.evaluate(async () => { try { await fetch('/private'); return false } catch { return true } }), true)
    await page.evaluate(() => { const media = document.createElement('audio'); media.src = '/private'; document.body.append(media); media.load() })
    await page.waitForTimeout(100)
    assert.equal(privateRequests, 0)
  } finally {
    await browser?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    assetLoader = undefined
  }
})
