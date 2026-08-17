import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchUpcomingAnnouncements, normalizeAnnouncement } from '../src/convex.js'
import { buildUpcomingProjectPayload, visualizerAbsoluteUrl } from '../src/discord.js'
import { readState, writeState } from '../src/state.js'
import { processUpcomingAnnouncements } from '../src/upcoming.js'
import type { UpcomingAnnouncement } from '../src/types.js'

function announcement(overrides: Partial<UpcomingAnnouncement> = {}): UpcomingAnnouncement {
  return {
    id: 'proj_1',
    title: 'Night Vessel',
    date: '2026-08-20',
    artist: 'Ada',
    exploreUrl: '/explore',
    creationTime: 1,
    ...overrides,
  }
}

test('starts watermark at now without sending existing projects', async () => {
  const sent: string[] = []
  const saved: number[] = []
  const now = 1_770_000_000_000
  const next = await processUpcomingAnnouncements(
    { cursor: null, lastSummaryWindowEnd: null, lastForcedSummaryWindowEnd: null },
    [announcement(), announcement({ id: 'proj_2', title: 'Second', creationTime: 2 })],
    {
      now,
      send: async (row) => {
        sent.push(row.id)
      },
      save: async (state) => {
        saved.push(state.upcomingAfterCreatedAt ?? 0)
      },
    },
  )

  assert.deepEqual(sent, [])
  assert.equal(next.upcomingAfterCreatedAt, now)
  assert.deepEqual(saved, [now])
})

test('sends projects after the persisted watermark and advances to max createdAt', async () => {
  const sent: string[] = []
  const saved: number[] = []
  const next = await processUpcomingAnnouncements(
    {
      cursor: null,
      lastSummaryWindowEnd: null,
      lastForcedSummaryWindowEnd: null,
      upcomingAfterCreatedAt: 10,
    },
    [
      announcement({ id: 'proj_3', title: 'Third', creationTime: 30 }),
      announcement({ creationTime: 1 }),
      announcement({ id: 'proj_2', title: 'Second', creationTime: 20 }),
    ],
    {
      send: async (row) => {
        sent.push(row.id)
      },
      save: async (state) => {
        saved.push(state.upcomingAfterCreatedAt ?? 0)
      },
    },
  )

  assert.deepEqual(sent, ['proj_2', 'proj_3'])
  assert.deepEqual(saved, [20, 30])
  assert.equal(next.upcomingAfterCreatedAt, 30)
})

test('does not use afterCreatedAt 0 as a watermark', async () => {
  const now = 1_770_000_000_000
  const next = await processUpcomingAnnouncements(
    {
      cursor: null,
      lastSummaryWindowEnd: null,
      lastForcedSummaryWindowEnd: null,
      upcomingAfterCreatedAt: 0,
    },
    [announcement({ creationTime: 1 })],
    {
      now,
      send: async () => {
        throw new Error('should not send existing projects')
      },
      save: async () => {},
    },
  )
  assert.equal(next.upcomingAfterCreatedAt, now)
})

test('does not advance watermark when send fails', async () => {
  const saved: Array<number | undefined> = []
  await assert.rejects(() => processUpcomingAnnouncements(
    {
      cursor: null,
      lastSummaryWindowEnd: null,
      lastForcedSummaryWindowEnd: null,
      upcomingAfterCreatedAt: 10,
    },
    [announcement({ creationTime: 20 })],
    {
      send: async () => {
        throw new Error('webhook failed')
      },
      save: async (state) => {
        saved.push(state.upcomingAfterCreatedAt)
      },
    },
  ))
  assert.deepEqual(saved, [])
})

test('checkpoints each successful post before sending the next project', async () => {
  const sent: string[] = []
  const saved: number[] = []
  await assert.rejects(() => processUpcomingAnnouncements(
    {
      cursor: null,
      lastSummaryWindowEnd: null,
      lastForcedSummaryWindowEnd: null,
      upcomingAfterCreatedAt: 10,
    },
    [
      announcement({ id: 'proj_2', creationTime: 20 }),
      announcement({ id: 'proj_3', creationTime: 30 }),
    ],
    {
      send: async (row) => {
        sent.push(row.id)
        if (row.id === 'proj_3') throw new Error('webhook failed')
      },
      save: async (state) => {
        saved.push(state.upcomingAfterCreatedAt ?? 0)
      },
    },
  ))
  assert.deepEqual(sent, ['proj_2', 'proj_3'])
  assert.deepEqual(saved, [20])
})

test('builds visualizer embed with title date artist and explore url', () => {
  const payload = buildUpcomingProjectPayload(
    announcement(),
    'https://visualizer.thevessel.fun',
  )
  assert.equal(payload.embeds[0]?.title, 'Night Vessel')
  assert.equal(payload.embeds[0]?.url, 'https://visualizer.thevessel.fun/explore')
  assert.deepEqual(payload.embeds[0]?.fields, [
    { name: 'Date', value: '2026-08-20', inline: true },
    { name: 'Artist', value: 'Ada', inline: true },
  ])
  assert.equal(visualizerAbsoluteUrl('https://visualizer.thevessel.fun', '/explore'), 'https://visualizer.thevessel.fun/explore')
})

test('normalizes announcement rows from Convex including createdAt', () => {
  const row = normalizeAnnouncement({
    _id: 'jx123',
    createdAt: 99,
    title: 'Night Vessel',
    releaseDate: 'TBD',
    artist: 'Ada',
    exploreUrl: '/explore',
  })
  assert.deepEqual(row, {
    id: 'jx123',
    title: 'Night Vessel',
    date: 'TBD',
    artist: 'Ada',
    exploreUrl: '/explore',
    creationTime: 99,
  })
})

test('persists upcomingAfterCreatedAt in bot state and ignores 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vessel-discord-bot-'))
  const path = join(dir, 'state.json')
  try {
    await writeState(path, {
      cursor: null,
      lastSummaryWindowEnd: null,
      lastForcedSummaryWindowEnd: null,
      upcomingAfterCreatedAt: 1_770_000_000_000,
    })
    const state = await readState(path)
    assert.equal(state.upcomingAfterCreatedAt, 1_770_000_000_000)

    await writeState(path, {
      cursor: null,
      lastSummaryWindowEnd: null,
      lastForcedSummaryWindowEnd: null,
      upcomingAfterCreatedAt: 0,
    })
    assert.equal((await readState(path)).upcomingAfterCreatedAt, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('polls Convex with persisted afterCreatedAt and only accepts success arrays', async () => {
  const originalFetch = globalThis.fetch
  const calls: unknown[] = []
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ status: 'success', value: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const rows = await fetchUpcomingAnnouncements(
      'https://festive-hummingbird-510.convex.cloud',
      'upcoming:listAnnouncements',
      1_770_000_000_000,
    )
    assert.deepEqual(rows, [])
    assert.deepEqual(calls, [{
      path: 'upcoming:listAnnouncements',
      args: { afterCreatedAt: 1_770_000_000_000 },
      format: 'json',
    }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('refuses to poll Convex with afterCreatedAt 0', async () => {
  await assert.rejects(
    () => fetchUpcomingAnnouncements(
      'https://festive-hummingbird-510.convex.cloud',
      'upcoming:listAnnouncements',
      0,
    ),
    /afterCreatedAt must be a positive timestamp/,
  )
})

test('ignores Convex responses that are not status success with an array', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'error', errorMessage: 'missing afterCreatedAt' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch

  try {
    await assert.rejects(
      () => fetchUpcomingAnnouncements(
        'https://festive-hummingbird-510.convex.cloud',
        'upcoming:listAnnouncements',
        1,
      ),
      /missing afterCreatedAt/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
