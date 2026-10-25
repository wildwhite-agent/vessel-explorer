import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedPngDimensions, requireVesselId, requireSequenceId } from '../../server/utils/media-limits.ts'
import { BoundedWorkCache } from '../../server/utils/bounded-work.ts'

test('Vessel IDs reject all noncanonical or out-of-range forms before use', () => {
  for (const id of [undefined, '', '0', '-1', '01', '1.0', '1e4', '0x10', 'Infinity', 'NaN', '10001', '100000000', '9007199254740993', ' 1']) {
    assert.throws(() => requireVesselId(id), { statusCode: 400 })
  }
  assert.equal(requireVesselId('1'), 1)
  assert.equal(requireVesselId('10000'), 10000)
  for (let id = 1; id <= 10_000; id++) {
    const cols = Math.ceil(Math.sqrt(id))
    const { w, h } = boundedPngDimensions(cols, Math.ceil(id / cols), Math.max(1, Math.floor(400 / cols)))
    assert.ok(w * h <= 160_000)
  }
  for (const dims of [[1e8, 1, 1], [1, 1, 1e8], [0, 0, 1], [NaN, 1, 1]]) {
    assert.throws(() => boundedPngDimensions(...dims as [number, number, number]))
  }
})

test('sequence IDs fit uint256 without decimal coercion', () => {
  assert.equal(requireSequenceId('0'), '0')
  assert.equal(requireSequenceId(String(2n ** 256n - 1n)), String(2n ** 256n - 1n))
  for (const id of ['01', '1e2', String(2n ** 256n), '9'.repeat(1000)]) {
    assert.throws(() => requireSequenceId(id), { statusCode: 400 })
  }
})

test('work is deduplicated, concurrency capped, failed jobs released and cache bounded', async () => {
  const cache = new BoundedWorkCache<string>(1, 2, 4)
  let finish!: (value: string) => void
  const first = cache.get('a', () => new Promise(resolve => { finish = resolve }), 1000, v => v.length)
  const duplicate = cache.get('a', () => { throw Error('duplicate work') }, 1000, v => v.length)
  await assert.rejects(cache.get('b', async () => 'b', 1000, v => v.length), { statusCode: 503 })
  finish('aa')
  assert.deepEqual(await Promise.all([first, duplicate]), ['aa', 'aa'])
  await cache.get('b', async () => 'bbb', 1000, v => v.length)
  let rerendered = false
  await cache.get('a', async () => { rerendered = true; return 'a' }, 0, v => v.length)
  assert.ok(rerendered)
  await assert.rejects(cache.get('err', async () => { throw Error('failure') }, 1000, () => 1))
  assert.equal(await cache.get('err', async () => 'ok', 1000, v => v.length), 'ok')
})
