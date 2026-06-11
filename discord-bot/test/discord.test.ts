import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDiscordPayload, sentenceForActivity } from '../src/discord.js'
import type { VesselActivity } from '../src/types.js'

test('formats minimal activity sentences', () => {
  assert.equal(sentenceForActivity(activity({ action: 'claim', detail: 'claimed #728' })), '**0xabc1...def2** claimed on **vault #2623**')
  assert.equal(sentenceForActivity(activity({ action: 'write', detail: 'wrote 2,623 bytes to #2623' })), '**0xabc1...def2** wrote 2,623 bytes on **vault #2623**')
  assert.equal(sentenceForActivity(activity({ action: 'write', entry: 3 })), '**0xabc1...def2** wrote 2,623 bytes to entry 3 on **vault #2623**')
  assert.equal(sentenceForActivity(activity({ action: 'machine', detail: 'set machine on #5134', vesselId: '5134', craftType: 'machine' })), '**0xabc1...def2** set machine on **machine #5134**')
  assert.equal(sentenceForActivity(activity({ action: 'delegate', detail: 'delegated #2623' })), '**0xabc1...def2** set delegate on **vault #2623**')
  assert.equal(sentenceForActivity(activity({ action: 'setvaultentry', detail: 'set entry 3 on #2623' })), '**0xabc1...def2** set vault entry 3 on **vault #2623**')
  assert.equal(sentenceForActivity(activity({ action: 'write' }), 'agent.yougogirl.eth'), '**agent.yougogirl.eth** wrote 2,623 bytes on **vault #2623**')
  assert.equal(sentenceForActivity(activity({
    action: 'sale',
    vesselId: '303',
    buyer: '0xb0b0000000000000000000000000000000000001',
    seller: '0x5e11000000000000000000000000000000000002',
    salePrice: {
      amountRaw: '4890000000000000',
      decimals: 18,
      symbol: 'ETH',
      token: null,
      formatted: '0.00489 ETH',
    },
  }), { actor: 'buyer.eth', seller: 'seller.eth' }), '**buyer.eth** bought **vault #303** from **seller.eth** for **0.00489 ETH**')
})

test('builds Discord embed with vessel link and OG image', () => {
  const payload = buildDiscordPayload(activity({ action: 'machine', vesselId: '5134' }), 'https://vessel.worldcomputer.art')

  assert.equal(payload.embeds[0]?.title, 'Machine set')
  assert.equal(payload.embeds[0]?.url, 'https://evm.now/tx/0xhash')
  assert.equal(payload.embeds[0]?.image?.url, 'https://vessel.worldcomputer.art/api/og/5134?v=25274501-machine-5134-1780943435')
  assert.match(payload.embeds[0]?.description || '', /\n\nhttps:\/\/vessel\.worldcomputer\.art\/5134/)
  assert.match(payload.embeds[0]?.description || '', /https:\/\/vessel\.worldcomputer\.art\/5134/)
})

test('builds human action titles', () => {
  assert.equal(buildDiscordPayload(activity({ action: 'write', craftType: 'vault' }), 'https://vessel.worldcomputer.art').embeds[0]?.title, 'Vault write')
  assert.equal(buildDiscordPayload(activity({ action: 'sale' }), 'https://vessel.worldcomputer.art').embeds[0]?.title, 'Sale')
  assert.equal(buildDiscordPayload(activity({ action: 'setvaultentry' }), 'https://vessel.worldcomputer.art').embeds[0]?.title, 'Vault entry set')
  assert.equal(buildDiscordPayload(activity({ action: 'delegate' }), 'https://vessel.worldcomputer.art').embeds[0]?.title, 'Delegate set')
})

test('builds VWU claim embed with vessel image', () => {
  const payload = buildDiscordPayload(activity({
    action: 'vwuclaim',
    amount: '12',
    detail: 'claimed 12 VWU from #2623',
  }), 'https://vessel.worldcomputer.art', 'agent.eth')

  assert.equal(payload.embeds[0]?.title, 'VWU Claim')
  assert.equal(payload.embeds[0]?.description, '**agent.eth** claimed **12 VWU** from **vault #2623**\n\nhttps://vessel.worldcomputer.art/2623')
  assert.equal(payload.embeds[0]?.image?.url, 'https://vessel.worldcomputer.art/api/og/2623?v=25274501-vwuclaim-2623-1780943435')
})

test('builds Sequence mint embed with sequence image', () => {
  const payload = buildDiscordPayload(activity({
    action: 'sequencemint',
    source: 'sequence',
    subjectType: 'sequence',
    subjectId: '8',
    amount: '1',
    vesselId: null,
    craftType: null,
    to: '0xabc100000000000000000000000000000000def2',
  }), 'https://vessel.worldcomputer.art', 'collector.eth')

  assert.equal(payload.embeds[0]?.title, 'Sequence Mint')
  assert.equal(payload.embeds[0]?.description, '**collector.eth** minted **1x Sequence #8**\n\nhttps://vessel.worldcomputer.art/address/0xabc100000000000000000000000000000000def2')
  assert.equal(payload.embeds[0]?.image?.url, 'https://vessel.worldcomputer.art/api/sequence-og/8?v=25274501-0xhash-8%3A1')
})

test('collapses Sequence batch mint copy', () => {
  const payload = buildDiscordPayload([
    activity({
      action: 'sequencemint',
      source: 'sequence',
      subjectType: 'sequence',
      subjectId: '1',
      amount: '4',
      vesselId: null,
      craftType: null,
    }),
    activity({
      action: 'sequencemint',
      source: 'sequence',
      subjectType: 'sequence',
      subjectId: '2',
      amount: '2',
      vesselId: null,
      craftType: null,
    }),
  ], 'https://vessel.worldcomputer.art', 'collector.eth')

  assert.equal(payload.embeds[0]?.description, '**collector.eth** minted **6 Sequence editions** (#1, #2)\n\nhttps://vessel.worldcomputer.art/address/0xabc100000000000000000000000000000000def2')
  assert.equal(payload.embeds[0]?.image?.url, 'https://vessel.worldcomputer.art/api/sequence-og/1?v=25274501-0xhash-1%3A4%2C2%3A2')
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
