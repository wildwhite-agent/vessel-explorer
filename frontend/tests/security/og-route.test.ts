import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp, createRouter, toWebHandler, createError } from 'h3'
import handler from '../../server/api/og/[id].ts'

let lookups = 0
Object.assign(globalThis, {
  fetchIndexerJson: async (path: string) => {
    lookups++
    const id = Number(path.split('/').pop())
    if (id === 9) return null
    if (id === 10) throw createError({ statusCode: 502, message: 'fixture upstream failure' })
    return { id, payloadHex: '0x0102', colorMode: 0, isMachine: false }
  },
})
const router = createRouter().use('/api/og/:id', handler)
const request = toWebHandler(createApp().use(router))

test('invalid IDs never fetch and missing tokens never render fallbacks', async () => {
  for (const id of ['0', '10001', '100000000', '1e4', '-1', '01', 'NaN', '1.5']) {
    const response = await request(new Request(`http://localhost/api/og/${id}`))
    assert.equal(response.status, 400)
  }
  assert.equal(lookups, 0)
  assert.equal((await request(new Request('http://localhost/api/og/9'))).status, 404)
  assert.equal((await request(new Request('http://localhost/api/og/10'))).status, 502)
})

test('valid GET and HEAD share a bounded cached image; mutations are rejected', async () => {
  for (const id of [1, 10_000]) {
    const response = await request(new Request(`http://localhost/api/og/${id}`))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.ok(bytes.readUInt32BE(16) <= 400)
    assert.ok(bytes.readUInt32BE(20) <= 400)
    const before = lookups
    const head = await request(new Request(`http://localhost/api/og/${id}`, { method: 'HEAD' }))
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), String(bytes.length))
    assert.equal(lookups, before)
  }
  assert.equal((await request(new Request('http://localhost/api/og/1', { method: 'POST' }))).status, 405)
})
