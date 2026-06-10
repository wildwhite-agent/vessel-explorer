import 'dotenv/config'

import pg from 'pg'
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbiItem,
} from 'viem'
import { mainnet } from 'viem/chains'

const { Client } = pg

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const WORK_UNIT_ADDRESS = getAddress('0x476072a4e9648c1a115f47f268353586b0012c97')
const WORK_UNIT_START_BLOCK = 24_918_488n
const WORK_UNIT_CLAIMED_EVENT = parseAbiItem(
  'event WorkUnitClaimed(address indexed claimant, uint256 indexed craftTokenId, bytes32 previousHash, bytes32 newHash, uint256 amount, uint256 timestamp)',
)

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const skipVwu = args.has('--skip-vwu')
const skipSequence = args.has('--skip-sequence')
const logRange = positiveIntegerEnv('BACKFILL_LOG_RANGE', 2_000)
const startBlock = optionalIntegerArg('--start-block')
const endBlock = optionalIntegerArg('--end-block')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const rpc = createPublicClient({
  chain: mainnet,
  transport: http(firstRpcUrl(), { timeout: 60_000 }),
})
const db = new Client({ connectionString: databaseUrl })

let vwuClaims = 0
let sequenceMints = 0

await db.connect()
try {
  if (!skipVwu) await backfillVwuClaims()
  if (!skipSequence) await backfillSequenceMints()
} finally {
  await db.end()
}

console.log(`done vwuClaims=${vwuClaims} sequenceMints=${sequenceMints} dryRun=${dryRun}`)

async function backfillVwuClaims() {
  const latest = await rpc.getBlockNumber()
  const fromBlock = startBlock === null ? WORK_UNIT_START_BLOCK : BigInt(startBlock)
  const toBlock = endBlock === null ? latest : BigInt(endBlock)

  for (let from = fromBlock; from <= toBlock; from += BigInt(logRange)) {
    const to = from + BigInt(logRange - 1) > toBlock
      ? toBlock
      : from + BigInt(logRange - 1)

    const logs = await rpc.getLogs({
      address: WORK_UNIT_ADDRESS,
      event: WORK_UNIT_CLAIMED_EVENT,
      fromBlock: from,
      toBlock: to,
    })

    for (const log of logs) {
      const decoded = decodeEventLog({
        abi: [WORK_UNIT_CLAIMED_EVENT],
        data: log.data,
        topics: log.topics,
      })
      const claimant = getAddress(decoded.args.claimant)
      const craftTokenId = decoded.args.craftTokenId
      const amount = decoded.args.amount
      const timestamp = decoded.args.timestamp

      vwuClaims++
      if (dryRun) continue

      await db.query(`
        INSERT INTO activity_events (
          id,
          type,
          source,
          source_event,
          token_id,
          subject_type,
          subject_id,
          amount,
          actor,
          "from",
          "to",
          tx_hash,
          block_number,
          log_index,
          timestamp
        ) VALUES (
          $1, 'vwuclaim', 'workunit', 'WorkUnitClaimed', $2::bigint, 'craft', $2::bigint, $3::bigint, $4, $5, $4, $6, $7::bigint, $8, $9::bigint
        )
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          source = EXCLUDED.source,
          source_event = EXCLUDED.source_event,
          token_id = EXCLUDED.token_id,
          subject_type = EXCLUDED.subject_type,
          subject_id = EXCLUDED.subject_id,
          amount = EXCLUDED.amount,
          actor = EXCLUDED.actor,
          "from" = EXCLUDED."from",
          "to" = EXCLUDED."to",
          tx_hash = EXCLUDED.tx_hash,
          block_number = EXCLUDED.block_number,
          log_index = EXCLUDED.log_index,
          timestamp = EXCLUDED.timestamp
      `, [
        activityId(log.blockNumber, log.logIndex),
        craftTokenId.toString(),
        amount.toString(),
        claimant,
        ZERO_ADDRESS,
        log.transactionHash,
        log.blockNumber.toString(),
        Number(log.logIndex),
        timestamp.toString(),
      ])
    }

    console.log(`vwu ${from}-${to} logs=${logs.length} total=${vwuClaims}`)
  }
}

async function backfillSequenceMints() {
  const result = await db.query(`
    SELECT
      tx_hash,
      log_index,
      batch_index,
      block_number,
      "from",
      "to",
      token_id,
      value,
      timestamp,
      COUNT(*) OVER (PARTITION BY tx_hash, log_index) AS log_item_count
    FROM sequence_transfers
    WHERE "from" = $1
      AND "to" <> $1
      AND value > 0
      ${startBlock === null ? '' : 'AND block_number >= $2::bigint'}
      ${endBlock === null ? '' : `AND block_number <= $${startBlock === null ? 2 : 3}::bigint`}
    ORDER BY block_number ASC, log_index ASC, batch_index ASC
  `, [
    ZERO_ADDRESS,
    ...(startBlock === null ? [] : [String(startBlock)]),
    ...(endBlock === null ? [] : [String(endBlock)]),
  ])

  for (const row of result.rows) {
    sequenceMints++
    if (dryRun) continue

    const sourceEvent = Number(row.log_item_count) > 1 ? 'TransferBatch' : 'TransferSingle'
    await db.query(`
      INSERT INTO activity_events (
        id,
        type,
        source,
        source_event,
        subject_type,
        subject_id,
        amount,
        actor,
        "from",
        "to",
        tx_hash,
        block_number,
        log_index,
        timestamp
      ) VALUES (
        $1, 'sequencemint', 'sequence', $2, 'sequence', $3::bigint, $4::bigint, $5, $6, $5, $7, $8::bigint, $9, $10::bigint
      )
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        source = EXCLUDED.source,
        source_event = EXCLUDED.source_event,
        subject_type = EXCLUDED.subject_type,
        subject_id = EXCLUDED.subject_id,
        amount = EXCLUDED.amount,
        actor = EXCLUDED.actor,
        "from" = EXCLUDED."from",
        "to" = EXCLUDED."to",
        tx_hash = EXCLUDED.tx_hash,
        block_number = EXCLUDED.block_number,
        log_index = EXCLUDED.log_index,
        timestamp = EXCLUDED.timestamp
    `, [
      `${activityId(row.block_number, row.log_index)}-${row.batch_index}`,
      sourceEvent,
      String(row.token_id),
      String(row.value),
      row.to,
      row.from,
      row.tx_hash,
      String(row.block_number),
      Number(row.log_index),
      String(row.timestamp),
    ])
  }

  console.log(`sequenceMints=${sequenceMints}`)
}

function firstRpcUrl() {
  const value = process.env.PONDER_RPC_URLS_1
    || process.env.PONDER_RPC_URL
    || process.env.RPC_URL
    || 'https://ethereum-rpc.publicnode.com'
  return value.split(/\s+/).filter(Boolean)[0]
}

function positiveIntegerEnv(name, fallbackValue) {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallbackValue
}

function optionalIntegerArg(name) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  const value = inline
    ? inline.slice(prefix.length)
    : process.argv[process.argv.indexOf(name) + 1]
  if (!value || value === name) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null
}

function activityId(blockNumber, logIndex) {
  return `${blockNumber}-${logIndex}`
}
