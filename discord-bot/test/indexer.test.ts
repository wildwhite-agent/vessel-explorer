import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cursorForActivity,
  fetchActivity,
  fetchAllActivity,
  isIncludedActivity,
  newActivitiesSinceCursor,
} from '../src/indexer.js'
import type { VesselActivity } from '../src/types.js'

test('skips transfer and metadata events by default', () => {
  const excluded = new Set(['transfer', 'metadata'])

  assert.equal(isIncludedActivity(activity({ action: 'transfer' }), excluded), false)
  assert.equal(isIncludedActivity(activity({ action: 'metadata' }), excluded), false)
  assert.equal(isIncludedActivity(activity({ action: 'unknown', functionName: 'refreshMetadata(uint256)' }), excluded), false)
  assert.equal(isIncludedActivity(activity({ action: 'write' }), excluded), true)
  assert.equal(isIncludedActivity(activity({ action: 'sale' }), excluded), true)
})

test('skips unsupported rows without vesselId', () => {
  assert.equal(isIncludedActivity(activity({ vesselId: null }), new Set()), false)
  assert.equal(isIncludedActivity(activity({
    action: 'sequencemint',
    vesselId: null,
    source: 'sequence',
    subjectType: 'sequence',
    subjectId: '8',
  }), new Set()), true)
})

test('returns new activities oldest-to-newest', () => {
  const newestFirst = [
    activity({ hash: '0x3', blockNumber: '3', action: 'machine' }),
    activity({ hash: '0x2', blockNumber: '2', action: 'write' }),
    activity({ hash: '0x1', blockNumber: '1', action: 'claim' }),
  ]

  const rows = newActivitiesSinceCursor(newestFirst, cursorForActivity(newestFirst[2]!))
  assert.deepEqual(rows.map((row) => row.hash), ['0x2', '0x3'])
})

test('with no cursor, backfill order is oldest-to-newest', () => {
  const newestFirst = [
    activity({ hash: '0x3', blockNumber: '3' }),
    activity({ hash: '0x2', blockNumber: '2' }),
  ]

  const rows = newActivitiesSinceCursor(newestFirst, null)
  assert.deepEqual(rows.map((row) => row.hash), ['0x2', '0x3'])
})

test('fetchActivity sends pagination and time range filters', async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input))
    return Response.json([activity({ hash: '0x1' })])
  }) as typeof fetch

  try {
    await fetchActivity('https://indexer.example', {
      limit: 1000,
      page: 2,
      startTime: 1780945200,
      endTime: 1781031600,
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  const url = new URL(requests[0]!)
  assert.equal(url.pathname, '/activity')
  assert.equal(url.searchParams.get('limit'), '1000')
  assert.equal(url.searchParams.get('page'), '2')
  assert.equal(url.searchParams.get('startTime'), '1780945200')
  assert.equal(url.searchParams.get('endTime'), '1781031600')
})

test('fetchAllActivity paginates until a short page', async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input))
    const page = new URL(String(input)).searchParams.get('page')
    return Response.json(page === '1'
      ? [activity({ hash: '0x1' }), activity({ hash: '0x2' })]
      : [activity({ hash: '0x3' })])
  }) as typeof fetch

  try {
    const rows = await fetchAllActivity('https://indexer.example', {
      limit: 2,
      startTime: 10,
      endTime: 20,
    })
    assert.deepEqual(rows.map((row) => row.hash), ['0x1', '0x2', '0x3'])
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(requests.length, 2)
  assert.equal(new URL(requests[0]!).searchParams.get('page'), '1')
  assert.equal(new URL(requests[1]!).searchParams.get('page'), '2')
})

function activity(overrides: Partial<VesselActivity> = {}): VesselActivity {
  return {
    hash: '0xhash',
    from: '0xabc100000000000000000000000000000000def2',
    to: '0x0000000000000000000000000000000000000000',
    timeStamp: '1780943435',
    blockNumber: '25274501',
    input: '0x',
    isError: '0',
    functionName: '',
    action: 'write',
    source: 'vessel',
    subjectType: 'craft',
    subjectId: '2623',
    amount: null,
    vesselId: '2623',
    craftType: 'vault',
    entry: null,
    detail: 'wrote 2,623 bytes to #2623',
    ...overrides,
  }
}
