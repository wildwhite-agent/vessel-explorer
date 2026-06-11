import assert from 'node:assert/strict'
import test from 'node:test'
import { processActivities } from '../src/bot.js'
import { activityKey } from '../src/indexer.js'
import type { BotState, VesselActivity } from '../src/types.js'

test('latest start mode records newest included event without sending backlog', async () => {
  const sent: VesselActivity[] = []
  const saved: BotState[] = []

  const state = await processActivities({ cursor: null, lastSummaryWindowEnd: null, lastForcedSummaryWindowEnd: null }, [
    activity({ hash: '0x2', blockNumber: '2', action: 'write' }),
    activity({ hash: '0x1', blockNumber: '1', action: 'claim' }),
  ], {
    excludedEventTypes: new Set(['transfer', 'metadata']),
    startMode: 'latest',
    sendLatestOnStart: false,
    send: async (group) => {
      sent.push(...group)
    },
    save: async (nextState) => {
      saved.push(nextState)
    },
  })

  assert.equal(sent.length, 0)
  assert.deepEqual(state.cursor, {
    blockNumber: '2',
    hash: '0x2',
    action: 'write',
    vesselId: '2623',
  })
  assert.deepEqual(saved, [state])
})

test('sendLatestOnStart sends newest included event once on empty state', async () => {
  const sent: VesselActivity[] = []
  const saved: BotState[] = []

  const state = await processActivities({ cursor: null, lastSummaryWindowEnd: null, lastForcedSummaryWindowEnd: null }, [
    activity({ hash: '0x2', blockNumber: '2', action: 'write' }),
    activity({ hash: '0x1', blockNumber: '1', action: 'claim' }),
  ], {
    excludedEventTypes: new Set(['transfer', 'metadata']),
    startMode: 'latest',
    sendLatestOnStart: true,
    send: async (group) => {
      sent.push(...group)
    },
    save: async (nextState) => {
      saved.push(nextState)
    },
  })

  assert.deepEqual(sent.map((row) => row.hash), ['0x2'])
  assert.deepEqual(saved, [state])
  assert.equal(state.cursor?.hash, '0x2')
})

test('sendLatestOnStart sends newest included event when cursor is already current', async () => {
  const sent: VesselActivity[] = []
  const saved: BotState[] = []
  const current = {
    blockNumber: '2',
    hash: '0x2',
    action: 'write',
    vesselId: '2623',
  }

  const state = await processActivities({ cursor: current, lastSummaryWindowEnd: null, lastForcedSummaryWindowEnd: null }, [
    activity({ hash: '0x2', blockNumber: '2', action: 'write' }),
    activity({ hash: '0x1', blockNumber: '1', action: 'claim' }),
  ], {
    excludedEventTypes: new Set(['transfer', 'metadata']),
    startMode: 'latest',
    sendLatestOnStart: true,
    send: async (group) => {
      sent.push(...group)
    },
    save: async (nextState) => {
      saved.push(nextState)
    },
  })

  assert.deepEqual(sent.map((row) => row.hash), ['0x2'])
  assert.deepEqual(saved, [state])
  assert.deepEqual(state.cursor, current)
})

test('sendLatestOnStart sends missed events once when cursor is behind', async () => {
  const sent: VesselActivity[] = []

  const state = await processActivities({
    cursor: {
      blockNumber: '1',
      hash: '0x1',
      action: 'claim',
      vesselId: '2623',
    },
    lastSummaryWindowEnd: null,
    lastForcedSummaryWindowEnd: null,
  }, [
    activity({ hash: '0x3', blockNumber: '3', action: 'machine' }),
    activity({ hash: '0x2', blockNumber: '2', action: 'write' }),
    activity({ hash: '0x1', blockNumber: '1', action: 'claim' }),
  ], {
    excludedEventTypes: new Set(['transfer', 'metadata']),
    startMode: 'latest',
    sendLatestOnStart: true,
    send: async (group) => {
      sent.push(...group)
    },
    save: async () => {},
  })

  assert.deepEqual(sent.map((row) => row.hash), ['0x2', '0x3'])
  assert.equal(state.cursor?.hash, '0x3')
})

test('backfill sends included events once oldest-to-newest', async () => {
  const sent: VesselActivity[] = []

  const state = await processActivities({ cursor: null, lastSummaryWindowEnd: null, lastForcedSummaryWindowEnd: null }, [
    activity({ hash: '0x3', blockNumber: '3', action: 'metadata' }),
    activity({ hash: '0x2', blockNumber: '2', action: 'write' }),
    activity({ hash: '0x1', blockNumber: '1', action: 'claim' }),
  ], {
    excludedEventTypes: new Set(['transfer', 'metadata']),
    startMode: 'backfill',
    sendLatestOnStart: false,
    send: async (group) => {
      sent.push(...group)
    },
    save: async () => {},
  })

  assert.deepEqual(sent.map((row) => row.hash), ['0x1', '0x2'])
  assert.equal(state.cursor?.hash, '0x2')
})

test('checkpoints without sending when saved cursor is missing from fetched page', async () => {
  const sent: VesselActivity[] = []
  const saved: BotState[] = []
  const warnings: string[] = []

  const state = await processActivities({
    cursor: {
      blockNumber: '1',
      hash: '0xmissing',
      action: 'claim',
      vesselId: '2623',
    },
    lastSummaryWindowEnd: null,
    lastForcedSummaryWindowEnd: null,
  }, [
    activity({ hash: '0x3', blockNumber: '3', action: 'machine' }),
    activity({ hash: '0x2', blockNumber: '2', action: 'write' }),
  ], {
    excludedEventTypes: new Set(['transfer', 'metadata']),
    startMode: 'latest',
    sendLatestOnStart: false,
    send: async (group) => {
      sent.push(...group)
    },
    save: async (nextState) => {
      saved.push(nextState)
    },
    warn: (message) => {
      warnings.push(message)
    },
  })

  assert.deepEqual(sent, [])
  assert.equal(state.cursor?.hash, '0x3')
  assert.deepEqual(saved, [state])
  assert.match(warnings[0] ?? '', /cursor was not found/)
  assert.deepEqual(state.sentActivityKeys, [
    activityKey(activity({ hash: '0x3', blockNumber: '3', action: 'machine' })),
    activityKey(activity({ hash: '0x2', blockNumber: '2', action: 'write' })),
  ])
})

test('skips activity keys already recorded as sent', async () => {
  const duplicate = activity({ hash: '0x2', blockNumber: '2', action: 'write' })
  const sent: VesselActivity[] = []

  const state = await processActivities({
    cursor: {
      blockNumber: '1',
      hash: '0x1',
      action: 'claim',
      vesselId: '2623',
    },
    lastSummaryWindowEnd: null,
    lastForcedSummaryWindowEnd: null,
    sentActivityKeys: [activityKey(duplicate)],
  }, [
    activity({ hash: '0x3', blockNumber: '3', action: 'machine' }),
    duplicate,
    activity({ hash: '0x1', blockNumber: '1', action: 'claim' }),
  ], {
    excludedEventTypes: new Set(['transfer', 'metadata']),
    startMode: 'latest',
    sendLatestOnStart: false,
    send: async (group) => {
      sent.push(...group)
    },
    save: async () => {},
  })

  assert.deepEqual(sent.map((row) => row.hash), ['0x3'])
  assert.equal(state.cursor?.hash, '0x3')
  assert.deepEqual(state.sentActivityKeys, [
    activityKey(duplicate),
    activityKey(activity({ hash: '0x3', blockNumber: '3', action: 'machine' })),
  ])
})

test('collapses Sequence mint rows by transaction before sending', async () => {
  const sent: VesselActivity[][] = []
  const saved: BotState[] = []

  const state = await processActivities({
    cursor: {
      blockNumber: '1',
      hash: '0x1',
      action: 'claim',
      vesselId: '2623',
    },
    lastSummaryWindowEnd: null,
    lastForcedSummaryWindowEnd: null,
  }, [
    sequenceMint({ hash: '0xseq', blockNumber: '3', subjectId: '2', amount: '2' }),
    sequenceMint({ hash: '0xseq', blockNumber: '3', subjectId: '1', amount: '4' }),
    activity({ hash: '0x1', blockNumber: '1', action: 'claim' }),
  ], {
    excludedEventTypes: new Set(['transfer', 'metadata']),
    startMode: 'latest',
    sendLatestOnStart: false,
    send: async (group) => {
      sent.push(group)
    },
    save: async (nextState) => {
      saved.push(nextState)
    },
  })

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0]?.map((row) => row.subjectId), ['1', '2'])
  assert.equal(state.cursor?.hash, '0xseq')
  assert.equal(state.cursor?.vesselId, '2')
  assert.equal(saved.length, 1)
})

test('does not advance cursor when Discord send fails', async () => {
  const originalState: BotState = {
    cursor: {
      blockNumber: '1',
      hash: '0x1',
      action: 'claim',
      vesselId: '2623',
    },
    lastSummaryWindowEnd: null,
    lastForcedSummaryWindowEnd: null,
  }
  const saved: BotState[] = []

  await assert.rejects(
    processActivities(originalState, [
      activity({ hash: '0x2', blockNumber: '2', action: 'write' }),
      activity({ hash: '0x1', blockNumber: '1', action: 'claim' }),
    ], {
      excludedEventTypes: new Set(['transfer', 'metadata']),
      startMode: 'latest',
      sendLatestOnStart: false,
      send: async () => {
        throw new Error('webhook down')
      },
      save: async (nextState) => {
        saved.push(nextState)
      },
    }),
    /webhook down/,
  )

  assert.deepEqual(saved, [])
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
    subjectType: 'vessel',
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

function sequenceMint(overrides: Partial<VesselActivity> = {}): VesselActivity {
  return activity({
    action: 'sequencemint',
    source: 'sequence',
    subjectType: 'sequence',
    subjectId: '1',
    amount: '1',
    vesselId: null,
    craftType: null,
    from: '0xabc100000000000000000000000000000000def2',
    to: '0xabc100000000000000000000000000000000def2',
    detail: 'minted 1x Sequence #1',
    ...overrides,
  })
}
