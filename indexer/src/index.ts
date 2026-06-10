import { ponder } from 'ponder:registry'
import type { Context } from 'ponder:registry'
import {
  account,
  activityEvent,
  approval,
  operatorApproval,
  payloadWrite,
  protocol,
  seaportSale,
  token,
  transfer,
  vesselEntry,
  workUnitBalance,
  workUnitProtocol,
  workUnitTransfer,
} from 'ponder:schema'
import {
  decodeEventLog,
  encodePacked,
  getAddress,
  hexToBytes,
  keccak256,
  toEventSelector,
  type Hex,
} from 'viem'

import { ShipyardWorkUnitAbi } from '../abis/ShipyardWorkUnitAbi'
import { VesselAbi } from '../abis/VesselAbi'
import {
  INDEXER_START_BLOCK,
  VESSEL_ADDRESS,
  VESSEL_START_BLOCK,
  WORK_UNIT_ADDRESS,
  WORK_UNIT_START_BLOCK,
} from '../ponder.config'
import { findSeaportSaleForTransfer, type SeaportSaleMatch } from './seaport'

type Address = `0x${string}`
type PonderEvent = {
  args: Record<string, unknown>
  transaction: { hash: Hex; from?: Address; input?: Hex }
  block: { number: bigint; timestamp: bigint }
  log: { logIndex: number }
}

type TokenState = {
  tokenId: bigint
  claimed: boolean
  owner: Address | null
  vesselType: string
  filled: boolean
  payloadHex: Hex
  payloadBytes: number
  capacityBytes: number
  colorMode: number
  role: number | null
  claimBlock: bigint | null
  entryCount: number
  chosenEntry: number
  delegate: Address | null
  machine: Address | null
  chosenMachine: Address | null
  locked: boolean
  lockBlock: bigint | null
  isVault: boolean
  isMachine: boolean
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const TOTAL_VESSELS = 10_000
const TOKEN_SEED_BATCH_SIZE = 500
const BLOCKS_PER_DAY = 7_200n
const LOCK_DIVISOR = 10n
const MAX_UINT256 = (1n << 256n) - 1n
const PAYLOAD_SET_TOPIC = toEventSelector('PayloadSet(uint256,uint256)')

const DETAIL_CALLS = [
  'craftToClaimed',
  'craftToType',
  'craftToPayload',
  'craftToColorMode',
  'craftToRole',
  'craftToClaimBlock',
  'craftToEntry',
  'craftToChosenEntry',
  'craftToDelegate',
  'craftToMachine',
  'craftToChosenMachine',
  'craftToLocked',
  'craftToLockBlock',
  'craftToVaultStatus',
  'craftToMachineStatus',
] as const

ponder.on('Vessel:setup', async ({ context }) => {
  const protocolState = await readProtocolState(context)

  await context.db
    .insert(protocol)
    .values(protocolState)
    .onConflictDoUpdate(protocolState)

  for (let start = 1; start <= TOTAL_VESSELS; start += TOKEN_SEED_BATCH_SIZE) {
    const rows = []
    for (let id = start; id < start + TOKEN_SEED_BATCH_SIZE && id <= TOTAL_VESSELS; id++) {
      rows.push(seedTokenRow(id, protocolState.block_event_0, protocolState.lock_start))
    }

    await context.db.insert(token).values(rows).onConflictDoNothing()
  }
})

ponder.on('Vessel:Transfer', async ({ event, context }) => {
  const from = normalizeAddress(event.args.from as Address)
  const to = normalizeAddress(event.args.to as Address)
  const tokenId = event.args.tokenId as bigint
  const meta = eventMeta(event)
  const isClaim = from === ZERO_ADDRESS

  await ensureAccounts(context, [from, to], event.block.timestamp)

  await context.db
    .insert(transfer)
    .values({
      tx_hash: meta.tx_hash,
      log_index: meta.log_index,
      block_number: meta.block_number,
      token_id: tokenId,
      from,
      to,
      timestamp: meta.timestamp,
    })
    .onConflictDoNothing()

  if (to !== ZERO_ADDRESS) {
    await context.db
      .insert(approval)
      .values({
        token_id: tokenId,
        owner: to,
        approved: null,
        ...meta,
        updated_at: meta.timestamp,
      })
      .onConflictDoUpdate({
        owner: to,
        approved: null,
        ...meta,
        updated_at: meta.timestamp,
      })
  }

  if (isClaim) {
    const state = await refreshTokenState(context, tokenId, {
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      owner: to,
      lastTransferAt: event.block.timestamp,
      touchPayload: true,
    })

    await recordInitialPayloadIfPresent(context, event, state)
    await incrementProtocolClaimedCount(context, event.block.number, event.block.timestamp)
  } else {
    await context.db
      .insert(token)
      .values({
        ...seedTokenRow(Number(tokenId), BigInt(VESSEL_START_BLOCK), 0n),
        claimed: true,
        owner: to,
        last_transfer_at: event.block.timestamp,
        updated_at: event.block.timestamp,
        block_number: event.block.number,
      })
      .onConflictDoUpdate({
        claimed: true,
        owner: to,
        last_transfer_at: event.block.timestamp,
        updated_at: event.block.timestamp,
        block_number: event.block.number,
      })
  }

  const sale = isClaim
    ? null
    : await findSaleForTransfer(context, event, tokenId, from, to)
  if (sale) {
    await context.db
      .insert(seaportSale)
      .values({
        activity_id: eventId(event),
        tx_hash: meta.tx_hash,
        transfer_log_index: meta.log_index,
        block_number: meta.block_number,
        token_id: tokenId,
        seaport_address: sale.seaportAddress,
        seaport_log_index: sale.seaportLogIndex,
        order_hash: sale.orderHash,
        buyer: sale.buyer,
        seller: sale.seller,
        payment_token: sale.paymentToken,
        payment_symbol: sale.paymentSymbol,
        payment_decimals: sale.paymentDecimals,
        payment_amount_raw: sale.paymentAmountRaw?.toString() ?? null,
        timestamp: meta.timestamp,
      })
      .onConflictDoUpdate({
        tx_hash: meta.tx_hash,
        transfer_log_index: meta.log_index,
        block_number: meta.block_number,
        token_id: tokenId,
        seaport_address: sale.seaportAddress,
        seaport_log_index: sale.seaportLogIndex,
        order_hash: sale.orderHash,
        buyer: sale.buyer,
        seller: sale.seller,
        payment_token: sale.paymentToken,
        payment_symbol: sale.paymentSymbol,
        payment_decimals: sale.paymentDecimals,
        payment_amount_raw: sale.paymentAmountRaw?.toString() ?? null,
        timestamp: meta.timestamp,
      })
  }

  await insertActivity(context, {
    id: eventId(event),
    type: isClaim ? 'claim' : sale ? 'sale' : 'transfer',
    source_event: sale ? 'OrderFulfilled' : 'Transfer',
    token_id: tokenId,
    actor: isClaim ? to : sale ? sale.buyer : from,
    from,
    to,
    ...meta,
  })
})

ponder.on('Vessel:PayloadSet', async ({ event, context }) => {
  await handlePayloadSet(context, event)
})

ponder.on('Vessel:MachineSet', async ({ event, context }) => {
  const tokenId = event.args._tokenId as bigint
  const machine = normalizeNullable(event.args._machine as Address)
  const actor = actorFromEvent(event)

  await ensureAccounts(context, [machine, actor], event.block.timestamp)
  await refreshTokenState(context, tokenId, {
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    touchPayload: true,
  })

  await insertActivity(context, {
    id: eventId(event),
    type: 'machine',
    source_event: 'MachineSet',
    token_id: tokenId,
    actor,
    machine,
    ...eventMeta(event),
  })
})

ponder.on('Vessel:EntrySet', async ({ event, context }) => {
  const tokenId = event.args._tokenId as bigint
  const entry = Number(event.args._entry ?? 0n)
  const actor = actorFromEvent(event)

  await refreshTokenState(context, tokenId, {
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    touchPayload: true,
  })

  await insertActivity(context, {
    id: eventId(event),
    type: 'setvaultentry',
    source_event: 'EntrySet',
    token_id: tokenId,
    actor,
    entry,
    ...eventMeta(event),
  })
})

ponder.on('Vessel:DelegateSet', async ({ event, context }) => {
  const tokenId = event.args._tokenId as bigint
  const delegate = normalizeNullable(event.args._delegate as Address)
  const actor = actorFromEvent(event)

  await ensureAccounts(context, [delegate, actor], event.block.timestamp)
  await refreshTokenState(context, tokenId, {
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  })

  await insertActivity(context, {
    id: eventId(event),
    type: 'delegate',
    source_event: 'DelegateSet',
    token_id: tokenId,
    actor,
    delegate,
    ...eventMeta(event),
  })
})

ponder.on('Vessel:RoleSet', async ({ event, context }) => {
  const user = normalizeAddress(event.args._user as Address)
  const role = Number(event.args._role ?? 0)
  await ensureAccounts(context, [user], event.block.timestamp)

  await context.db
    .insert(account)
    .values({
      address: user,
      role,
      first_seen_at: event.block.timestamp,
      updated_at: event.block.timestamp,
    })
    .onConflictDoUpdate({
      role,
      updated_at: event.block.timestamp,
    })

  await insertActivity(context, {
    id: eventId(event),
    type: 'role',
    source_event: 'RoleSet',
    actor: user,
    role,
    ...eventMeta(event),
  })
})

ponder.on('Vessel:MetadataUpdate', async ({ event, context }) => {
  const tokenId = event.args._tokenId as bigint
  await refreshTokenState(context, tokenId, {
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    touchPayload: true,
  })
  await recoverPayloadSetsFromReceipt(context, event)

  await insertActivity(context, {
    id: eventId(event),
    type: 'metadata',
    source_event: 'MetadataUpdate',
    token_id: tokenId,
    actor: actorFromEvent(event),
    ...eventMeta(event),
  })
})

async function handlePayloadSet(context: Context, event: PonderEvent) {
  const tokenId = event.args._tokenId as bigint
  const payloadBytes = Number(event.args._length ?? 0n)
  const actor = actorFromEvent(event)
  const state = await refreshTokenState(context, tokenId, {
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    touchPayload: true,
  })
  const entryIndex = state.isVault
    ? Math.max(0, state.entryCount - 1)
    : state.entryCount > 0
      ? 0
      : null
  const payloadHex =
    entryIndex !== null && state.isVault
      ? await readVaultEntry(context, tokenId, entryIndex, event.block.number)
      : state.payloadHex

  await recordPayloadWrite(context, event, state, {
    entryIndex,
    payloadHex,
    payloadBytes,
    writer: actor,
  })

  await insertActivity(context, {
    id: eventId(event),
    type: 'write',
    source_event: 'PayloadSet',
    token_id: tokenId,
    actor,
    entry: entryIndex,
    payload_bytes: payloadBytes,
    ...eventMeta(event),
  })
}

async function recoverPayloadSetsFromReceipt(context: Context, event: PonderEvent) {
  let receipt: Awaited<ReturnType<typeof context.client.getTransactionReceipt>>
  try {
    receipt = await context.client.getTransactionReceipt({ hash: event.transaction.hash })
  } catch (error) {
    console.warn('PayloadSet receipt recovery failed', {
      txHash: event.transaction.hash,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  for (const log of receipt.logs) {
    if (normalizeAddress(log.address as Address) !== normalizeAddress(VESSEL_ADDRESS)) continue
    if (log.topics[0] !== PAYLOAD_SET_TOPIC) continue

    let args: { _tokenId?: bigint; _length?: bigint }
    try {
      const decoded = decodeEventLog({
        abi: VesselAbi,
        data: log.data,
        eventName: 'PayloadSet',
        topics: log.topics,
      })
      args = decoded.args as { _tokenId?: bigint; _length?: bigint }
    } catch {
      continue
    }

    const logIndex = Number(log.logIndex)
    if (typeof args._tokenId !== 'bigint' || !Number.isInteger(logIndex) || logIndex < 0) {
      continue
    }

    await handlePayloadSet(context, {
      args: {
        _tokenId: args._tokenId,
        _length: args._length ?? 0n,
      },
      block: event.block,
      log: { logIndex },
      transaction: event.transaction,
    })
  }
}

async function findSaleForTransfer(
  context: Context,
  event: PonderEvent,
  tokenId: bigint,
  seller: Address,
  buyer: Address,
): Promise<SeaportSaleMatch | null> {
  try {
    const receipt = await context.client.getTransactionReceipt({ hash: event.transaction.hash })
    return findSeaportSaleForTransfer(receipt.logs, {
      vesselAddress: VESSEL_ADDRESS,
      tokenId,
      seller,
      buyer,
    })
  } catch (error) {
    console.warn('Seaport sale receipt parsing failed', {
      txHash: event.transaction.hash,
      tokenId: tokenId.toString(),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

ponder.on('Vessel:LockStarted', async ({ event, context }) => {
  await refreshProtocolFromChain(context, event.block.number, event.block.timestamp)

  await insertActivity(context, {
    id: eventId(event),
    type: 'lock',
    source_event: 'LockStarted',
    actor: actorFromEvent(event),
    ...eventMeta(event),
  })
})

ponder.on('Vessel:Approval', async ({ event, context }) => {
  const owner = normalizeAddress(event.args.owner as Address)
  const approved = normalizeNullable(event.args.approved as Address)
  const tokenId = event.args.tokenId as bigint
  const meta = eventMeta(event)

  await ensureAccounts(context, [owner, approved], event.block.timestamp)
  await context.db
    .insert(approval)
    .values({
      token_id: tokenId,
      owner,
      approved,
      ...meta,
      updated_at: meta.timestamp,
    })
    .onConflictDoUpdate({
      owner,
      approved,
      ...meta,
      updated_at: meta.timestamp,
    })

  await insertActivity(context, {
    id: eventId(event),
    type: 'approval',
    source_event: 'Approval',
    token_id: tokenId,
    actor: owner,
    from: owner,
    to: approved,
    ...meta,
  })
})

ponder.on('Vessel:ApprovalForAll', async ({ event, context }) => {
  const owner = normalizeAddress(event.args.owner as Address)
  const operator = normalizeAddress(event.args.operator as Address)
  const approved = Boolean(event.args.approved)
  const meta = eventMeta(event)

  await ensureAccounts(context, [owner, operator], event.block.timestamp)
  await context.db
    .insert(operatorApproval)
    .values({
      owner,
      operator,
      approved,
      ...meta,
      updated_at: meta.timestamp,
    })
    .onConflictDoUpdate({
      approved,
      ...meta,
      updated_at: meta.timestamp,
    })

  await insertActivity(context, {
    id: eventId(event),
    type: 'approvalforall',
    source_event: 'ApprovalForAll',
    actor: owner,
    from: owner,
    to: operator,
    ...meta,
  })
})

ponder.on('ShipyardWorkUnit:setup', async ({ context }) => {
  const blockNumber = BigInt(WORK_UNIT_START_BLOCK)
  const [name, symbol, decimals, totalSupply, vesselCollection] = await Promise.all([
    safeReadWorkUnit(context, 'name', [], 'The Vessel Shipyard Work Unit', blockNumber),
    safeReadWorkUnit(context, 'symbol', [], 'VWU', blockNumber),
    safeReadWorkUnit(context, 'decimals', [], 0, blockNumber),
    safeReadWorkUnit(context, 'totalSupply', [], 0n, blockNumber),
    safeReadWorkUnit(context, 'vesselCollection', [], VESSEL_ADDRESS, blockNumber),
  ])

  const state = {
    id: 'main',
    token_address: WORK_UNIT_ADDRESS,
    name: String(name),
    symbol: String(symbol),
    decimals: Number(decimals),
    total_supply: totalSupply as bigint,
    vessel_collection: normalizeAddress(vesselCollection as Address),
    updated_at: 0n,
    block_number: blockNumber,
  }

  await context.db
    .insert(workUnitProtocol)
    .values(state)
    .onConflictDoUpdate(state)
})

ponder.on('ShipyardWorkUnit:Transfer', async ({ event, context }) => {
  const from = normalizeAddress(event.args.from as Address)
  const to = normalizeAddress(event.args.to as Address)
  const value = event.args.value as bigint
  const meta = eventMeta(event)

  await ensureAccounts(context, [from, to], event.block.timestamp)

  await context.db
    .insert(workUnitTransfer)
    .values({
      tx_hash: meta.tx_hash,
      log_index: meta.log_index,
      block_number: meta.block_number,
      from,
      to,
      value,
      timestamp: meta.timestamp,
    })
    .onConflictDoNothing()

  if (from !== ZERO_ADDRESS) {
    await adjustWorkUnitBalance(context, from, -value, meta)
  }
  if (to !== ZERO_ADDRESS) {
    await adjustWorkUnitBalance(context, to, value, meta)
  }

  if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) {
    await refreshWorkUnitTotalSupply(context, meta.block_number, meta.timestamp)
  }
})

async function readProtocolState(context: Context) {
  const seedBlock = BigInt(Math.max(INDEXER_START_BLOCK - 1, VESSEL_START_BLOCK))
  const [claimedCount, lockStart, blockEvent0, blockEvent1, defaultMachine, relics, creatorSupplyClaimed] =
    await Promise.all([
      safeRead(context, 'claimedCount', [], 0n, seedBlock),
      safeReadLatest(context, 'lockStart', [], 0n),
      safeReadLatest(context, 'blockEvents', [0n], BigInt(VESSEL_START_BLOCK)),
      safeReadLatest(context, 'blockEvents', [1n], 0n),
      safeReadLatest(context, 'defaultMachine', [], ZERO_ADDRESS),
      safeReadLatest(context, 'relics', [], ZERO_ADDRESS),
      safeReadLatest(context, 'creatorSupplyClaimed', [], false),
    ])

  return {
    id: 'main',
    vessel_address: VESSEL_ADDRESS,
    claimed_count: claimedCount,
    lock_start: lockStart,
    block_event_0: blockEvent0,
    block_event_1: blockEvent1,
    default_machine: normalizeNullable(defaultMachine as Address),
    relics: normalizeNullable(relics as Address),
    creator_supply_claimed: creatorSupplyClaimed,
    updated_at: 0n,
    block_number: 0n,
  }
}

async function incrementProtocolClaimedCount(
  context: Context,
  blockNumber: bigint,
  timestamp: bigint,
) {
  const current = await context.db.find(protocol, { id: 'main' })
  if (current) {
    await context.db
      .update(protocol, { id: 'main' })
      .set((row) => ({
        claimed_count: row.claimed_count + 1n,
        updated_at: timestamp,
        block_number: blockNumber,
      }))
    return
  }

  const initial = await readProtocolState(context)
  await context.db
    .insert(protocol)
    .values({
      ...initial,
      claimed_count: initial.claimed_count + 1n,
      updated_at: timestamp,
      block_number: blockNumber,
    })
    .onConflictDoNothing()
}

async function refreshProtocolFromChain(
  context: Context,
  blockNumber: bigint,
  timestamp: bigint,
) {
  const state = await readProtocolStateAt(context, blockNumber, timestamp)
  await context.db
    .insert(protocol)
    .values(state)
    .onConflictDoUpdate(state)
}

async function readProtocolStateAt(
  context: Context,
  blockNumber: bigint,
  timestamp: bigint,
) {
  const [claimedCount, lockStart, blockEvent0, blockEvent1, defaultMachine, relics, creatorSupplyClaimed] =
    await Promise.all([
      safeRead(context, 'claimedCount', [], 0n, blockNumber),
      safeRead(context, 'lockStart', [], 0n, blockNumber),
      safeRead(context, 'blockEvents', [0n], BigInt(VESSEL_START_BLOCK), blockNumber),
      safeRead(context, 'blockEvents', [1n], 0n, blockNumber),
      safeRead(context, 'defaultMachine', [], ZERO_ADDRESS, blockNumber),
      safeRead(context, 'relics', [], ZERO_ADDRESS, blockNumber),
      safeRead(context, 'creatorSupplyClaimed', [], false, blockNumber),
    ])

  return {
    id: 'main',
    vessel_address: VESSEL_ADDRESS,
    claimed_count: claimedCount,
    lock_start: lockStart,
    block_event_0: blockEvent0,
    block_event_1: blockEvent1,
    default_machine: normalizeNullable(defaultMachine as Address),
    relics: normalizeNullable(relics as Address),
    creator_supply_claimed: creatorSupplyClaimed,
    updated_at: timestamp,
    block_number: blockNumber,
  }
}

function seedTokenRow(id: number, blockEvent0: bigint, lockStart: bigint) {
  const tokenId = BigInt(id)
  const vesselType = deterministicType(tokenId, blockEvent0)
  const colorMode = deterministicColorMode(tokenId, blockEvent0)
  const lockBlock = lockStart === 0n ? null : lockStart + (tokenId * BLOCKS_PER_DAY) / LOCK_DIVISOR

  return {
    token_id: tokenId,
    claimed: false,
    owner: null,
    vessel_type: vesselType,
    filled: false,
    payload_hex: '0x',
    payload_bytes: 0,
    capacity_bytes: id,
    color_mode: colorMode,
    role: null,
    claim_block: null,
    entry_count: 0,
    chosen_entry: 0,
    delegate: null,
    machine: null,
    chosen_machine: null,
    locked: false,
    lock_block: lockBlock,
    is_vault: vesselType === 'vault',
    is_machine: vesselType === 'machine',
    first_claimed_at: null,
    last_payload_at: null,
    last_transfer_at: null,
    updated_at: 0n,
    block_number: BigInt(VESSEL_START_BLOCK),
  }
}

async function refreshTokenState(
  context: Context,
  tokenId: bigint,
  opts: {
    blockNumber: bigint
    timestamp: bigint
    owner?: Address | null
    lastTransferAt?: bigint | null
    touchPayload?: boolean
  },
): Promise<TokenState> {
  const state = await readTokenState(context, tokenId, opts.blockNumber, opts.owner)
  const values = {
    token_id: tokenId,
    claimed: state.claimed,
    owner: state.owner,
    vessel_type: state.vesselType,
    filled: state.filled,
    payload_hex: state.payloadHex,
    payload_bytes: state.payloadBytes,
    capacity_bytes: state.capacityBytes,
    color_mode: state.colorMode,
    role: state.role,
    claim_block: state.claimBlock,
    entry_count: state.entryCount,
    chosen_entry: state.chosenEntry,
    delegate: state.delegate,
    machine: state.machine,
    chosen_machine: state.chosenMachine,
    locked: state.locked,
    lock_block: state.lockBlock,
    is_vault: state.isVault,
    is_machine: state.isMachine,
    first_claimed_at: state.claimed ? opts.timestamp : null,
    last_payload_at: opts.touchPayload ? opts.timestamp : null,
    last_transfer_at: opts.lastTransferAt ?? null,
    updated_at: opts.timestamp,
    block_number: opts.blockNumber,
  }

  await context.db
    .insert(token)
    .values(values)
    .onConflictDoUpdate((row) => ({
      claimed: values.claimed,
      owner: values.owner,
      vessel_type: values.vessel_type,
      filled: values.filled,
      payload_hex: values.payload_hex,
      payload_bytes: values.payload_bytes,
      capacity_bytes: values.capacity_bytes,
      color_mode: values.color_mode,
      role: values.role,
      claim_block: values.claim_block,
      entry_count: values.entry_count,
      chosen_entry: values.chosen_entry,
      delegate: values.delegate,
      machine: values.machine,
      chosen_machine: values.chosen_machine,
      locked: values.locked,
      lock_block: values.lock_block,
      is_vault: values.is_vault,
      is_machine: values.is_machine,
      first_claimed_at: row.first_claimed_at ?? values.first_claimed_at,
      last_payload_at: values.last_payload_at ?? row.last_payload_at,
      last_transfer_at: values.last_transfer_at ?? row.last_transfer_at,
      updated_at: values.updated_at,
      block_number: values.block_number,
    }))

  await ensureAccounts(
    context,
    [state.owner, state.delegate, state.machine, state.chosenMachine],
    opts.timestamp,
  )

  return state
}

async function readTokenState(
  context: Context,
  tokenId: bigint,
  blockNumber: bigint,
  ownerOverride?: Address | null,
): Promise<TokenState> {
  const results = await context.client.multicall({
    allowFailure: true,
    blockNumber,
    contracts: DETAIL_CALLS.map((functionName) => ({
      address: VESSEL_ADDRESS,
      abi: VesselAbi,
      functionName,
      args: [tokenId],
    })),
  })

  const claimed = boolResult(results, 0, false)
  const owner =
    ownerOverride !== undefined
      ? ownerOverride
      : claimed
        ? normalizeNullable(await safeRead(context, 'ownerOf', [tokenId], ZERO_ADDRESS, blockNumber) as Address)
        : null
  const vesselType = stringResult(results, 1, 'Capsule').toLowerCase()
  const payloadHex = cleanHex(hexResult(results, 2, '0x'))
  const entryCount = numberResult(results, 6, 0)
  const rawLockBlock = bigintResult(results, 12)
  const lockBlock = rawLockBlock === MAX_UINT256 ? null : rawLockBlock

  return {
    tokenId,
    claimed,
    owner,
    vesselType,
    filled: payloadByteLength(payloadHex) > 0,
    payloadHex,
    payloadBytes: payloadByteLength(payloadHex),
    capacityBytes: Number(tokenId),
    colorMode: numberResult(results, 3, deterministicColorMode(tokenId, BigInt(VESSEL_START_BLOCK))),
    role: nullableNumberResult(results, 4),
    claimBlock: bigintResult(results, 5),
    entryCount,
    chosenEntry: numberResult(results, 7, 0),
    delegate: normalizeNullable(hexResult(results, 8, ZERO_ADDRESS) as Address),
    machine: normalizeNullable(hexResult(results, 9, ZERO_ADDRESS) as Address),
    chosenMachine: normalizeNullable(hexResult(results, 10, ZERO_ADDRESS) as Address),
    locked: boolResult(results, 11, false),
    lockBlock,
    isVault: boolResult(results, 13, vesselType === 'vault'),
    isMachine: boolResult(results, 14, vesselType === 'machine'),
  }
}

async function recordInitialPayloadIfPresent(
  context: Context,
  event: PonderEvent,
  state: TokenState,
) {
  if (!state.filled || state.isMachine) return

  const entryIndex = state.isVault
    ? state.entryCount > 0
      ? state.entryCount - 1
      : null
    : 0
  const payloadHex = state.isVault && entryIndex !== null
    ? await readVaultEntry(context, state.tokenId, entryIndex, event.block.number)
    : state.payloadHex
  const payloadBytes = payloadByteLength(payloadHex)
  if (payloadBytes === 0) return

  await recordPayloadWrite(context, event, state, {
    entryIndex,
    payloadHex,
    payloadBytes,
    writer: actorFromEvent(event),
  })
}

async function recordPayloadWrite(
  context: Context,
  event: PonderEvent,
  state: TokenState,
  payload: {
    entryIndex: number | null
    payloadHex: Hex
    payloadBytes: number
    writer: Address | null
  },
) {
  const meta = eventMeta(event)
  if (payload.entryIndex !== null) {
    await context.db
      .insert(vesselEntry)
      .values({
        token_id: state.tokenId,
        entry_index: payload.entryIndex,
        payload_hex: payload.payloadHex,
        payload_bytes: payload.payloadBytes,
        tx_hash: meta.tx_hash,
        block_number: meta.block_number,
        log_index: meta.log_index,
        timestamp: meta.timestamp,
        updated_at: meta.timestamp,
      })
      .onConflictDoUpdate({
        payload_hex: payload.payloadHex,
        payload_bytes: payload.payloadBytes,
        tx_hash: meta.tx_hash,
        block_number: meta.block_number,
        log_index: meta.log_index,
        timestamp: meta.timestamp,
        updated_at: meta.timestamp,
      })
  }

  await context.db
    .insert(payloadWrite)
    .values({
      id: eventId(event),
      token_id: state.tokenId,
      entry_index: payload.entryIndex,
      payload_hex: payload.payloadHex,
      payload_bytes: payload.payloadBytes,
      writer: payload.writer,
      ...meta,
    })
    .onConflictDoNothing()
}

async function readVaultEntry(
  context: Context,
  tokenId: bigint,
  entryIndex: number,
  blockNumber: bigint,
): Promise<Hex> {
  return cleanHex(
    (await safeRead(
      context,
      'vaultToEntry',
      [tokenId, BigInt(entryIndex)],
      '0x',
      blockNumber,
    )) as Hex,
  )
}

async function ensureAccounts(
  context: Context,
  addresses: Array<Address | null | undefined>,
  timestamp: bigint,
) {
  for (const address of addresses) {
    if (!address || address === ZERO_ADDRESS) continue
    await context.db
      .insert(account)
      .values({
        address,
        role: null,
        first_seen_at: timestamp,
        updated_at: timestamp,
      })
      .onConflictDoUpdate((row) => ({
        role: row.role,
        first_seen_at: row.first_seen_at,
        updated_at: timestamp,
      }))
  }
}

async function insertActivity(
  context: Context,
  values: typeof activityEvent.$inferInsert,
) {
  await context.db.insert(activityEvent).values(values).onConflictDoNothing()
}

async function adjustWorkUnitBalance(
  context: Context,
  address: Address,
  delta: bigint,
  meta: ReturnType<typeof eventMeta>,
) {
  const current = await context.db.find(workUnitBalance, { address })
  if (current) {
    await context.db
      .update(workUnitBalance, { address })
      .set((row) => ({
        balance: row.balance + delta,
        updated_at: meta.timestamp,
        block_number: meta.block_number,
      }))
    return
  }

  if (delta <= 0n) {
    await context.db.insert(workUnitBalance).values({
      address,
      balance: 0n,
      updated_at: meta.timestamp,
      block_number: meta.block_number,
    })
    return
  }

  await context.db
    .insert(workUnitBalance)
    .values({
      address,
      balance: delta,
      updated_at: meta.timestamp,
      block_number: meta.block_number,
    })
    .onConflictDoUpdate((row) => ({
      balance: row.balance + delta,
      updated_at: meta.timestamp,
      block_number: meta.block_number,
    }))
}

async function refreshWorkUnitTotalSupply(
  context: Context,
  blockNumber: bigint,
  timestamp: bigint,
) {
  const totalSupply = await safeReadWorkUnit(context, 'totalSupply', [], 0n, blockNumber)
  await context.db
    .update(workUnitProtocol, { id: 'main' })
    .set({
      total_supply: totalSupply as bigint,
      updated_at: timestamp,
      block_number: blockNumber,
    })
}

async function safeReadWorkUnit<T>(
  context: Context,
  functionName: string,
  args: unknown[],
  fallback: T,
  blockNumber?: bigint,
): Promise<T> {
  try {
    const request = {
      address: WORK_UNIT_ADDRESS,
      abi: ShipyardWorkUnitAbi,
      functionName: functionName as never,
      args: args as never,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    }
    return (await context.client.readContract(request as never)) as T
  } catch {
    return fallback
  }
}

async function safeRead<T>(
  context: Context,
  functionName: string,
  args: unknown[],
  fallback: T,
  blockNumber?: bigint,
  cacheLatest = false,
): Promise<T> {
  try {
    const request = {
      address: VESSEL_ADDRESS,
      abi: VesselAbi,
      functionName: functionName as never,
      args: args as never,
      ...(blockNumber === undefined ? {} : { blockNumber }),
      ...(cacheLatest ? { cache: 'immutable' as const } : {}),
    }
    return (await context.client.readContract(request as never)) as T
  } catch {
    return fallback
  }
}

function safeReadLatest<T>(
  context: Context,
  functionName: string,
  args: unknown[],
  fallback: T,
) {
  return safeRead(context, functionName, args, fallback, undefined, true)
}

function resultAt(
  results: Array<{ status: 'success'; result: unknown } | { status: 'failure' }>,
  index: number,
) {
  const value = results[index]
  return value?.status === 'success' ? value.result : null
}

function boolResult(
  results: Array<{ status: 'success'; result: unknown } | { status: 'failure' }>,
  index: number,
  fallback: boolean,
) {
  const value = resultAt(results, index)
  return typeof value === 'boolean' ? value : fallback
}

function stringResult(
  results: Array<{ status: 'success'; result: unknown } | { status: 'failure' }>,
  index: number,
  fallback: string,
) {
  const value = resultAt(results, index)
  return typeof value === 'string' ? value : fallback
}

function hexResult(
  results: Array<{ status: 'success'; result: unknown } | { status: 'failure' }>,
  index: number,
  fallback: Hex,
) {
  const value = resultAt(results, index)
  return typeof value === 'string' && value.startsWith('0x') ? (value as Hex) : fallback
}

function numberResult(
  results: Array<{ status: 'success'; result: unknown } | { status: 'failure' }>,
  index: number,
  fallback: number,
) {
  const value = resultAt(results, index)
  if (value == null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function nullableNumberResult(
  results: Array<{ status: 'success'; result: unknown } | { status: 'failure' }>,
  index: number,
) {
  const value = resultAt(results, index)
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bigintResult(
  results: Array<{ status: 'success'; result: unknown } | { status: 'failure' }>,
  index: number,
) {
  const value = resultAt(results, index)
  return typeof value === 'bigint' ? value : null
}

function cleanHex(value: Hex): Hex {
  if (!value || value === '0x') return '0x'
  return value.length % 2 === 0 ? value : (`0x0${value.slice(2)}` as Hex)
}

function payloadByteLength(value: Hex): number {
  if (!value || value === '0x') return 0
  return hexToBytes(value).length
}

function deterministicType(tokenId: bigint, blockEvent0: bigint): string {
  const rank = permute(tokenId, blockEvent0)
  if (rank <= 1_500n) return 'machine'
  if (rank >= 1_500n && rank <= 5_150n) return 'vault'
  return 'capsule'
}

function deterministicColorMode(tokenId: bigint, blockEvent0: bigint): number {
  const W_GREY = 9_540n
  const W_RED = 40n
  const W_GREEN = 100n
  const W_TOTAL = 9_695n
  let value = BigInt(keccak256(encodePacked(['uint256', 'uint256'], [blockEvent0, tokenId]))) % W_TOTAL
  if (value < W_GREY) return 0
  value -= W_GREY
  if (value < W_RED) return 1
  value -= W_RED
  if (value < W_GREEN) return 2
  return 3
}

function permute(tokenId: bigint, blockEvent0: bigint): bigint {
  let value = tokenId - 1n

  for (;;) {
    let left = value & 127n
    let right = (value >> 7n) & 127n

    for (let round = 0n; round < 6n; round++) {
      const f =
        BigInt(keccak256(encodePacked(['uint256', 'uint256', 'uint256'], [right, blockEvent0, round]))) &
        127n
      const nextLeft = right
      const nextRight = (left ^ f) & 127n
      left = nextLeft
      right = nextRight
    }

    const y = left | (right << 7n)
    if (y < BigInt(TOTAL_VESSELS)) return y + 1n
    value = y
  }
}

function eventId(event: PonderEvent) {
  return `${event.block.number}-${event.log.logIndex}`
}

function eventMeta(event: PonderEvent) {
  return {
    tx_hash: event.transaction.hash,
    block_number: event.block.number,
    log_index: event.log.logIndex,
    timestamp: event.block.timestamp,
  }
}

function actorFromEvent(event: PonderEvent): Address | null {
  return normalizeNullable(event.transaction.from ?? ZERO_ADDRESS)
}

function normalizeAddress(address: Address): Address {
  return getAddress(address)
}

function normalizeNullable(address: Address | null | undefined): Address | null {
  if (!address) return null
  const normalized = normalizeAddress(address)
  return normalized === ZERO_ADDRESS ? null : normalized
}
