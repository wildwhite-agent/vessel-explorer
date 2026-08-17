import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeAnnouncement } from '../src/convex.js'
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

test('snapshots existing upcoming projects in latest mode without sending', async () => {
  const sent: string[] = []
  const next = await processUpcomingAnnouncements(
    { cursor: null, lastSummaryWindowEnd: null, lastForcedSummaryWindowEnd: null },
    [announcement(), announcement({ id: 'proj_2', title: 'Second', creationTime: 2 })],
    {
      startMode: 'latest',
      send: async (row) => {
        sent.push(row.id)
      },
      save: async () => {},
    },
  )

  assert.deepEqual(sent, [])
  assert.deepEqual(next.upcomingSeenKeys, ['proj_1', 'proj_2'])
})

test('sends only unseen upcoming projects in creation order', async () => {
  const sent: string[] = []
  const next = await processUpcomingAnnouncements(
    {
      cursor: null,
      lastSummaryWindowEnd: null,
      lastForcedSummaryWindowEnd: null,
      upcomingSeenKeys: ['proj_1'],
    },
    [
      announcement({ id: 'proj_3', title: 'Third', creationTime: 3 }),
      announcement(),
      announcement({ id: 'proj_2', title: 'Second', creationTime: 2 }),
    ],
    {
      startMode: 'latest',
      send: async (row) => {
        sent.push(row.id)
      },
      save: async () => {},
    },
  )

  assert.deepEqual(sent, ['proj_2', 'proj_3'])
  assert.deepEqual(next.upcomingSeenKeys, ['proj_1', 'proj_2', 'proj_3'])
})

test('backfill sends current projects when none have been seen', async () => {
  const sent: string[] = []
  await processUpcomingAnnouncements(
    { cursor: null, lastSummaryWindowEnd: null, lastForcedSummaryWindowEnd: null },
    [announcement({ id: 'proj_2', creationTime: 2 }), announcement({ id: 'proj_1', creationTime: 1 })],
    {
      startMode: 'backfill',
      send: async (row) => {
        sent.push(row.id)
      },
      save: async () => {},
    },
  )
  assert.deepEqual(sent, ['proj_1', 'proj_2'])
})

test('does not advance seen keys when send fails', async () => {
  await assert.rejects(() => processUpcomingAnnouncements(
    {
      cursor: null,
      lastSummaryWindowEnd: null,
      lastForcedSummaryWindowEnd: null,
      upcomingSeenKeys: [],
    },
    [announcement()],
    {
      startMode: 'latest',
      send: async () => {
        throw new Error('webhook failed')
      },
      save: async () => {},
    },
  ))
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

test('normalizes announcement rows from Convex including releaseDate alias', () => {
  const row = normalizeAnnouncement({
    _id: 'jx123',
    _creationTime: 99,
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

test('persists upcomingSeenKeys in bot state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vessel-discord-bot-'))
  const path = join(dir, 'state.json')
  try {
    await writeState(path, {
      cursor: null,
      lastSummaryWindowEnd: null,
      lastForcedSummaryWindowEnd: null,
      upcomingSeenKeys: ['proj_1'],
    })
    const state = await readState(path)
    assert.deepEqual(state.upcomingSeenKeys, ['proj_1'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
