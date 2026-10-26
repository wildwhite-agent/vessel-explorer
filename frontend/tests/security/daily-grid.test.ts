import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp, toWebHandler } from 'h3'
import sharp from 'sharp'
import handler from '../../server/api/daily-grid.ts'

let tokenLookups = 0
let cells = 12
let payloadOffset = 0
Object.assign(globalThis, {
  fetchIndexerJson: async (path: string) => {
    if (path === '/activity') return Array.from({ length: cells }, (_, i) => ({ action: 'write', vesselId: String(i + 1) }))
    const id = Number(path.split('/').pop())
    tokenLookups++
    await new Promise(resolve => setTimeout(resolve, 2))
    return { id, isMachine: false, payloadHex: '0x' + Buffer.alloc(id, id + payloadOffset).toString('hex') }
  },
})
const request = toWebHandler(createApp().use(handler))

test('a cold grid includes all twelve artworks and caches GET/HEAD together', async () => {
  const response = await request(new Request('http://localhost/api/daily-grid?start=1&end=2'))
  assert.equal(response.status, 200)
  assert.equal(tokenLookups, 12)
  const bytes = Buffer.from(await response.arrayBuffer())
  const pixels = await sharp(bytes).removeAlpha().raw().toBuffer()
  const colors = new Set<number>()
  for (let i = 0; i < pixels.length; i += 3) colors.add(pixels[i]!)
  for (let id = 1; id <= 12; id++) assert.ok(colors.has(id), `artwork ${id} must be present`)
  const head = await request(new Request('http://localhost/api/daily-grid?start=1&end=2', { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), String(bytes.length))
  assert.equal(tokenLookups, 12)
})

test('oversized grids fail explicitly before preview generation', async () => {
  cells = 257
  const before = tokenLookups
  assert.equal((await request(new Request('http://localhost/api/daily-grid?start=2&end=3'))).status, 422)
  assert.equal(tokenLookups, before)
  assert.equal((await request(new Request('http://localhost/api/daily-grid?start=1&end=9999999'))).status, 400)
})

test('forced summary revisions refresh grid cells and identical revisions reuse the grid', async () => {
  cells = 2
  const url = 'http://localhost/api/daily-grid?start=3&end=4&v='
  const before = tokenLookups
  const first = Buffer.from(await (await request(new Request(url + '100'))).arrayBuffer())
  assert.equal(tokenLookups, before + 2)
  payloadOffset = 100
  const updated = Buffer.from(await (await request(new Request(url + '200'))).arrayBuffer())
  assert.notDeepEqual(updated, first)
  assert.equal(tokenLookups, before + 4)
  const again = Buffer.from(await (await request(new Request(url + '200'))).arrayBuffer())
  assert.deepEqual(again, updated)
  assert.equal(tokenLookups, before + 4)
})
