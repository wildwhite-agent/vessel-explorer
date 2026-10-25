import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

const require = createRequire(import.meta.url)
test('Ponder resolves the same patched Hono as the app', () => {
  const ponderRequire = createRequire(import.meta.resolve('ponder'))
  assert.equal(ponderRequire.resolve('hono'), require.resolve('hono'))
  assert.match(require.resolve('hono'), /hono@4\.13\.14/)
})
test('Ponder global CORS defaults accept ordinary preflights', async () => {
  const app = new Hono().use(cors({ origin: '*', maxAge: 86400 })).get('/', c => c.text('ok'))
  const response = await app.request('/', {
    method: 'OPTIONS',
    headers: { Origin: 'https://example.org', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'content-type, x-client-version' },
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('access-control-allow-headers'), 'content-type,x-client-version')
})
