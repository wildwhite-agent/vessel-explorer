import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDailySummaryPayload,
  latestDueSummaryWindow,
  processDailySummary,
  type SummarySchedule,
  type SummaryWindow,
} from '../src/summary.js'
import type { BotState, ProtocolStats, VesselActivity } from '../src/types.js'

const schedule: SummarySchedule = {
  enabled: true,
  timeZone: 'America/New_York',
  hour: 15,
  minute: 0,
  windowHours: 24,
  deployedAt: new Date('2026-02-24T04:59:35.000Z'),
}

const stats: ProtocolStats = {
  tokens: {
    total: 10_000,
    claimed: 960,
    filled: 428,
    claimedCapacityBytes: 1_134_080,
    filledBytes: 528_782,
    uniqueHolders: 159,
  },
}

test('calculates day numbers from deploy anchor', () => {
  const day1 = latestDueSummaryWindow(
    schedule,
    { lastSummaryWindowEnd: null },
    new Date('2026-02-24T20:00:00.000Z'),
  )
  assert.equal(day1?.dayNumber, 1)
  assert.equal(day1?.startTime, 1771876800)
  assert.equal(day1?.endTime, 1771963200)

  const day106 = latestDueSummaryWindow(
    schedule,
    { lastSummaryWindowEnd: null },
    new Date('2026-06-09T19:00:00.000Z'),
  )
  assert.equal(day106?.dayNumber, 106)
  assert.equal(day106?.startTime, 1780945200)
  assert.equal(day106?.endTime, 1781031600)
  assert.equal(day106?.label, 'Jun 8, 3:00 PM - Jun 9, 3:00 PM ET')
})

test('does not return duplicate summary window after restart', () => {
  assert.equal(
    latestDueSummaryWindow(
      schedule,
      { lastSummaryWindowEnd: 1781031600 },
      new Date('2026-06-09T19:30:00.000Z'),
    ),
    null,
  )
})

test('can force the latest summary window on startup', () => {
  const window = latestDueSummaryWindow(
    schedule,
    { lastSummaryWindowEnd: 1781031600 },
    new Date('2026-06-09T19:30:00.000Z'),
    { forceLatest: true },
  )

  assert.equal(window?.dayNumber, 106)
  assert.equal(window?.endTime, 1781031600)
})

test('does not force the same latest summary window twice', () => {
  assert.equal(
    latestDueSummaryWindow(
      schedule,
      { lastSummaryWindowEnd: 1781031600, lastForcedSummaryWindowEnd: 1781031600 },
      new Date('2026-06-09T19:30:00.000Z'),
      { forceLatest: true },
    ),
    null,
  )
})

test('builds active daily summary embed with compact summary body', () => {
  const payload = buildDailySummaryPayload(window106(), [
    activity({ action: 'write', hash: '0x01', vesselId: '2623', from: '0x0000000000000000000000000000000000000001' }),
    activity({ action: 'write', hash: '0x02', vesselId: '2623', from: '0x0000000000000000000000000000000000000002' }),
    activity({ action: 'write', hash: '0x03', vesselId: '2624', from: '0x0000000000000000000000000000000000000003' }),
    activity({ action: 'write', hash: '0x04', vesselId: '2625', from: '0x0000000000000000000000000000000000000004' }),
    activity({ action: 'write', hash: '0x05', vesselId: '2626', from: '0x0000000000000000000000000000000000000005' }),
    activity({ action: 'write', hash: '0x06', vesselId: '2627' }),
    activity({ action: 'claim', hash: '0x07', vesselId: '728' }),
    activity({ action: 'claim', hash: '0x08', vesselId: '728' }),
    activity({ action: 'sale', hash: '0x09', vesselId: '303', from: '0x0000000000000000000000000000000000000006' }),
    activity({ action: 'setvaultentry', hash: '0x0a', vesselId: '2623' }),
    activity({ action: 'setvaultentry', hash: '0x0b', vesselId: '2623' }),
    activity({ action: 'machine', hash: '0x0c', vesselId: '5134' }),
    activity({ action: 'delegate', hash: '0x0d', vesselId: '5134' }),
  ], stats, 'https://vessel.worldcomputer.art')

  const embed = payload.embeds[0]
  assert.equal(embed?.title, 'Day 106')
  assert.equal(embed?.description, [
    '13 interactions · 8 crafts touched · 6 actors',
    'Claims: 2\nSales: 1\nWrites: 6\nSetVaultEntries: 2\nSetMachines: 1\nSetDelegates: 1',
    '***Protocol***\n960 / 10,000 claimed · 428 filled · 159 holders\n528,782 / 1,134,080 bytes filled',
  ].join('\n\n'))
  assert.equal(embed?.image?.url, 'https://vessel.worldcomputer.art/api/daily-grid?start=1780945200&end=1781031600')
  assert.equal(embed?.fields, undefined)
  assert.equal('footer' in embed!, false)
})

test('can cache-bust the daily grid image URL', () => {
  const payload = buildDailySummaryPayload(
    window106(),
    [activity({ action: 'machine', hash: '0x01', vesselId: '5134' })],
    stats,
    'https://vessel.worldcomputer.art',
    { gridCacheBust: 'machine-og-test' },
  )

  assert.equal(
    payload.embeds[0]?.image?.url,
    'https://vessel.worldcomputer.art/api/daily-grid?start=1780945200&end=1781031600&v=machine-og-test',
  )
})

test('builds quiet daily summary embed without image or footer', () => {
  const payload = buildDailySummaryPayload(window106(), [], stats, 'https://vessel.worldcomputer.art')
  const embed = payload.embeds[0]

  assert.equal(embed?.title, 'Day 106')
  assert.equal(embed?.description, [
    'No vessel interactions.',
    '***Protocol***\n960 / 10,000 claimed · 428 filled · 159 holders\n528,782 / 1,134,080 bytes filled',
  ].join('\n\n'))
  assert.equal(embed?.fields, undefined)
  assert.equal(embed?.image, undefined)
  assert.equal('footer' in embed!, false)
})

test('processDailySummary advances only after successful send', async () => {
  const state: BotState = {
    cursor: null,
    lastSummaryWindowEnd: null,
    lastForcedSummaryWindowEnd: null,
  }
  const failedSaves: BotState[] = []

  await assert.rejects(processDailySummary(state, {
    schedule,
    excludedEventTypes: new Set(['transfer', 'metadata']),
    vesselBaseUrl: 'https://vessel.worldcomputer.art',
    now: new Date('2026-06-09T19:00:00.000Z'),
    fetchActivities: async () => [activity({ action: 'write' })],
    fetchStats: async () => stats,
    send: async () => {
      throw new Error('webhook failed')
    },
    save: async (nextState) => {
      failedSaves.push(nextState)
    },
  }), /webhook failed/)

  assert.deepEqual(failedSaves, [])

  const sent: unknown[] = []
  const saved: BotState[] = []
  const nextState = await processDailySummary(state, {
    schedule,
    excludedEventTypes: new Set(['transfer', 'metadata']),
    vesselBaseUrl: 'https://vessel.worldcomputer.art',
    now: new Date('2026-06-09T19:00:00.000Z'),
    fetchActivities: async () => [
      activity({ action: 'transfer' }),
      activity({ action: 'metadata' }),
      activity({ action: 'write' }),
    ],
    fetchStats: async () => stats,
    send: async (payload) => {
      sent.push(payload)
    },
    save: async (nextState) => {
      saved.push(nextState)
    },
  })

  assert.equal(sent.length, 1)
  assert.equal(nextState.lastSummaryWindowEnd, 1781031600)
  assert.equal(saved.length, 1)
  assert.equal(saved[0]?.lastSummaryWindowEnd, 1781031600)
})

test('processDailySummary stores forced startup summary marker', async () => {
  const sent: unknown[] = []
  const saved: BotState[] = []
  const nextState = await processDailySummary({
    cursor: null,
    lastSummaryWindowEnd: 1781031600,
    lastForcedSummaryWindowEnd: null,
  }, {
    schedule,
    excludedEventTypes: new Set(['transfer', 'metadata']),
    vesselBaseUrl: 'https://vessel.worldcomputer.art',
    now: new Date('2026-06-09T19:30:00.000Z'),
    forceLatest: true,
    fetchActivities: async () => [activity({ action: 'write' })],
    fetchStats: async () => stats,
    send: async (payload) => {
      sent.push(payload)
    },
    save: async (state) => {
      saved.push(state)
    },
  })

  assert.equal(sent.length, 1)
  assert.equal(nextState.lastSummaryWindowEnd, 1781031600)
  assert.equal(nextState.lastForcedSummaryWindowEnd, 1781031600)
  assert.equal(saved[0]?.lastForcedSummaryWindowEnd, 1781031600)
})

function window106(): SummaryWindow {
  return {
    startTime: 1780945200,
    endTime: 1781031600,
    dayNumber: 106,
    label: 'Jun 8, 3:00 PM - Jun 9, 3:00 PM ET',
  }
}

function activity(overrides: Partial<VesselActivity> = {}): VesselActivity {
  return {
    hash: '0xhash',
    from: '0x0000000000000000000000000000000000000001',
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
    sequence: null,
    detail: 'wrote 2,623 bytes to #2623',
    ...overrides,
  }
}
