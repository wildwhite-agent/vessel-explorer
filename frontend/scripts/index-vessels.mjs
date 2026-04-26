import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import postgres from 'postgres'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { explainDatabaseError } from './db-errors.mjs'
import { loadEnvFile } from './load-env.mjs'

const TOTAL_VESSELS = 10000
const BATCH_SIZE = Number(process.env.VESSEL_INDEX_BATCH_SIZE || 20)
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const VESSEL_ADDRESS = '0xECb92Cc7112b80A2234936315BbB493fb48d1463'

const VESSEL_ABI = [
  { type: 'function', name: 'ownerOf', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToClaimed', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToType', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToPayload', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'bytes' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToColorMode', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToRole', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToClaimBlock', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToEntry', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToChosenEntry', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToDelegate', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToMachine', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'craftToChosenMachine', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
]

const DETAIL_CALLS = [
  'ownerOf',
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
]

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
await loadEnvFile(join(rootDir, '.env'))

const args = new Set(process.argv.slice(2))
const tokenArg = process.argv.find(arg => arg.startsWith('--tokens='))
const databaseUrl = process.env.DATABASE_URL
const rpcUrl = process.env.ETH_RPC_URL
  || process.env.NUXT_PUBLIC_EVM_CHAINS_MAINNET_RPC1
  || 'https://eth.llamarpc.com'

if (!databaseUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

if (!args.has('--all') && !args.has('--missing') && !args.has('--needs-payload') && !tokenArg) {
  console.error('usage: pnpm db:backfill | pnpm db:sync | node scripts/index-vessels.mjs --needs-payload | --tokens=1,2,3')
  process.exit(1)
}

const sql = postgres(databaseUrl, { max: 1, prepare: false })
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl),
})

try {
  const schema = await readFile(join(rootDir, 'db', '001_init.sql'), 'utf8')
  await sql.unsafe(schema)
  const migration = await readFile(join(rootDir, 'db', '002_add_payload.sql'), 'utf8')
  await sql.unsafe(migration)

  const payloadOnly = args.has('--needs-payload')
  const ids = await resolveTokenIds()
  console.log(`indexing ${ids.length} vessel token${ids.length === 1 ? '' : 's'} using ${rpcUrl}${payloadOnly ? ' (payload only)' : ''}`)

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE)
    if (payloadOnly) {
      await backfillPayloadOnly(batch)
    } else {
      const rows = await readTokenBatch(batch)
      await upsertTokenRows(rows)
    }
    console.log(`indexed ${Math.min(i + batch.length, ids.length)}/${ids.length}`)
  }

  await sql`
    insert into indexer_state (key, value, updated_at)
    values ('tokens_last_indexed_at', ${new Date().toISOString()}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `
} catch (e) {
  console.error(explainDatabaseError(e))
  process.exitCode = 1
} finally {
  await sql.end()
}

async function resolveTokenIds() {
  if (tokenArg) {
    return tokenArg
      .slice('--tokens='.length)
      .split(',')
      .map(value => Number(value.trim()))
      .filter(id => Number.isInteger(id) && id >= 1 && id <= TOTAL_VESSELS)
  }

  if (args.has('--missing')) {
    const rows = await sql`
      select series.id
      from generate_series(1, ${TOTAL_VESSELS}) as series(id)
      left join tokens on tokens.id = series.id
      where tokens.id is null
      order by series.id
    `
    return rows.map(row => row.id)
  }

  if (args.has('--needs-payload')) {
    const rows = await sql`
      select id from tokens
      where payload_bytes > 0 and payload_hex is null
      order by id
    `
    return rows.map(row => row.id)
  }

  return Array.from({ length: TOTAL_VESSELS }, (_, index) => index + 1)
}

async function backfillPayloadOnly(ids) {
  const contracts = ids.flatMap(id => ([{
    address: VESSEL_ADDRESS,
    abi: VESSEL_ABI,
    functionName: 'craftToPayload',
    args: [BigInt(id)],
  }]))

  const results = await publicClient.multicall({ contracts, allowFailure: true })

  for (let i = 0; i < ids.length; i++) {
    const raw = results[i]?.status === 'success' ? results[i].result : null
    const hex = raw && payloadByteLength(raw) > 0 ? normalizeHex(raw) : null
    if (hex) {
      await sql`update tokens set payload_hex = ${hex} where id = ${ids[i]}`
    }
  }
}

async function readTokenBatch(ids) {
  const contracts = ids.flatMap(id =>
    DETAIL_CALLS.map(functionName => ({
      address: VESSEL_ADDRESS,
      abi: VESSEL_ABI,
      functionName,
      args: [BigInt(id)],
    })),
  )

  const results = await publicClient.multicall({
    contracts,
    allowFailure: true,
  })

  return ids.map((id, rowIndex) => {
    const owner = addressValue(resultAt(results, rowIndex, 0))
    const claimed = boolValue(resultAt(results, rowIndex, 1)) ?? Boolean(owner)
    const vesselType = stringValue(resultAt(results, rowIndex, 2))?.toLowerCase() ?? null
    const rawPayload = resultAt(results, rowIndex, 3)
    const payloadBytes = payloadByteLength(rawPayload)
    const payloadHex = payloadBytes > 0 ? normalizeHex(rawPayload) : null

    return {
      id,
      claimed,
      owner_address: owner,
      vessel_type: vesselType,
      filled: payloadBytes > 0,
      payload_bytes: payloadBytes,
      payload_hex: payloadHex,
      capacity_bytes: id,
      color_mode: numberValue(resultAt(results, rowIndex, 4)),
      role: numberValue(resultAt(results, rowIndex, 5)),
      claim_block: numberValue(resultAt(results, rowIndex, 6)),
      entry_count: numberValue(resultAt(results, rowIndex, 7)),
      chosen_entry: numberValue(resultAt(results, rowIndex, 8)),
      delegate_address: addressValue(resultAt(results, rowIndex, 9)),
      machine_address: addressValue(resultAt(results, rowIndex, 10)),
      chosen_machine_address: addressValue(resultAt(results, rowIndex, 11)),
    }
  })
}

async function upsertTokenRows(rows) {
  if (rows.length === 0) return

  await sql`
    insert into tokens ${sql(rows,
      'id',
      'claimed',
      'owner_address',
      'vessel_type',
      'filled',
      'payload_bytes',
      'payload_hex',
      'capacity_bytes',
      'color_mode',
      'role',
      'claim_block',
      'entry_count',
      'chosen_entry',
      'delegate_address',
      'machine_address',
      'chosen_machine_address',
    )}
    on conflict (id) do update set
      claimed = excluded.claimed,
      owner_address = excluded.owner_address,
      vessel_type = excluded.vessel_type,
      filled = excluded.filled,
      payload_bytes = excluded.payload_bytes,
      payload_hex = excluded.payload_hex,
      capacity_bytes = excluded.capacity_bytes,
      color_mode = excluded.color_mode,
      role = excluded.role,
      claim_block = excluded.claim_block,
      entry_count = excluded.entry_count,
      chosen_entry = excluded.chosen_entry,
      delegate_address = excluded.delegate_address,
      machine_address = excluded.machine_address,
      chosen_machine_address = excluded.chosen_machine_address,
      details_updated_at = now()
  `
}

function resultAt(results, rowIndex, callIndex) {
  const value = results[rowIndex * DETAIL_CALLS.length + callIndex]
  return value?.status === 'success' ? value.result : null
}

function stringValue(value) {
  return typeof value === 'string' ? value : null
}

function boolValue(value) {
  return typeof value === 'boolean' ? value : null
}

function numberValue(value) {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function addressValue(value) {
  if (typeof value !== 'string') return null
  return value.toLowerCase() === ZERO_ADDRESS ? null : value.toLowerCase()
}

function payloadByteLength(value) {
  if (typeof value !== 'string') return 0
  const clean = value.startsWith('0x') ? value.slice(2) : value
  return clean.length / 2
}

function normalizeHex(value) {
  if (typeof value !== 'string') return null
  return value.startsWith('0x') ? value : `0x${value}`
}
