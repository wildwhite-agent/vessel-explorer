import 'dotenv/config'

import pg from 'pg'
import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
} from 'viem'
import { mainnet } from 'viem/chains'

const { Client } = pg

const VESSEL_ADDRESS = getAddress('0xECb92Cc7112b80A2234936315BbB493fb48d1463')
const VESSEL_ABI = parseAbi([
  'function tokenURI(uint256 tokenId) view returns (string)',
])
const ROLE_LABELS = {
  0: 'Undefined',
  1: 'Navigator',
  2: 'Steward',
  3: 'Merchant',
}

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const batchSize = positiveIntegerEnv('BACKFILL_BATCH_SIZE', 100)
const concurrency = positiveIntegerEnv('BACKFILL_CONCURRENCY', 3)
const maxRows = optionalIntegerArg('--limit')
const tokenId = optionalIntegerArg('--token-id')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const rpc = createPublicClient({
  chain: mainnet,
  transport: http(firstRpcUrl(), { timeout: 60_000 }),
})
const db = new Client({ connectionString: databaseUrl })

let scanned = 0
let updated = 0
let failures = 0
let cursor = 0n

await db.connect()
try {
  for (;;) {
    const rows = await nextBatch()
    if (!rows.length) break

    for (const group of chunk(rows, concurrency)) {
      await Promise.all(group.map(processToken))
    }

    cursor = BigInt(rows.at(-1).token_id)
    console.log(`scanned=${scanned} updated=${updated} failures=${failures}`)
    if (maxRows !== null && scanned >= maxRows) break
    if (tokenId !== null) break
  }
} finally {
  await db.end()
}

console.log(`done scanned=${scanned} updated=${updated} failures=${failures} dryRun=${dryRun}`)

async function nextBatch() {
  if (tokenId !== null && scanned > 0) return []
  const remainingLimit = maxRows === null ? batchSize : Math.max(0, Math.min(batchSize, maxRows - scanned))
  if (remainingLimit === 0) return []

  const result = tokenId === null
    ? await db.query(`
        SELECT token_id, role
        FROM tokens
        WHERE claimed = true
          AND token_id > $1::bigint
        ORDER BY token_id ASC
        LIMIT $2
      `, [cursor.toString(), remainingLimit])
    : await db.query(`
        SELECT token_id, role
        FROM tokens
        WHERE token_id = $1::bigint
        LIMIT 1
      `, [String(tokenId)])

  return result.rows
}

async function processToken(row) {
  scanned++
  const id = BigInt(row.token_id)

  try {
    const tokenUri = await rpc.readContract({
      address: VESSEL_ADDRESS,
      abi: VESSEL_ABI,
      functionName: 'tokenURI',
      args: [id],
    })
    const role = row.role == null ? null : Number(row.role)
    const traits = parseTokenTraits(tokenUri, role)

    if (dryRun) {
      console.log(`#${id} role=${traits.roleLabel ?? '-'} axiom=${traits.axiom} relic=${traits.relic} relicKind=${traits.relicKind ?? '-'} machineName=${traits.machineName ?? '-'}`)
      return
    }

    await db.query(`
      UPDATE tokens
      SET
        role_label = $2,
        axiom = $3,
        relic = $4,
        relic_kind = $5,
        machine_name = $6
      WHERE token_id = $1::bigint
    `, [
      id.toString(),
      traits.roleLabel,
      traits.axiom,
      traits.relic,
      traits.relicKind,
      traits.machineName,
    ])
    updated++
  } catch (error) {
    failures++
    console.error(`failed #${id}`, error instanceof Error ? error.message : error)
  }
}

function parseTokenTraits(tokenUri, role) {
  const metadata = parseTokenMetadata(tokenUri)
  const attributes = Array.isArray(metadata?.attributes) ? metadata.attributes : []
  const roleLabel = stringTrait(attributes, 'Role') || roleLabelForRole(role)

  return {
    roleLabel,
    axiom: booleanTrait(attributes, 'Axiom'),
    relic: booleanTrait(attributes, 'Relic'),
    relicKind: stringTrait(attributes, 'Relic Kind'),
    machineName: stringTrait(attributes, 'Machine Name'),
  }
}

function parseTokenMetadata(tokenUri) {
  const payload = decodeTokenUri(tokenUri)
  if (!payload) return null

  try {
    const parsed = JSON.parse(payload)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function decodeTokenUri(tokenUri) {
  const value = String(tokenUri || '').trim()
  if (!value) return null
  if (value.startsWith('{')) return value
  if (!value.startsWith('data:')) return null

  const comma = value.indexOf(',')
  if (comma === -1) return null

  const meta = value.slice(0, comma).toLowerCase()
  const data = value.slice(comma + 1)

  try {
    if (meta.includes(';base64')) {
      return Buffer.from(data, 'base64').toString('utf8')
    }
    return decodeURIComponent(data)
  } catch {
    return null
  }
}

function roleLabelForRole(role) {
  return role == null ? null : ROLE_LABELS[role] ?? null
}

function stringTrait(attributes, name) {
  const value = attributeValue(attributes, name)
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

function booleanTrait(attributes, name) {
  const value = attributeValue(attributes, name)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return false

  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === 'yes' || normalized === '1'
}

function attributeValue(attributes, name) {
  const wanted = normalizeTraitName(name)
  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== 'object') continue
    const traitName = String(attribute.trait_type ?? attribute.traitType ?? '')
    if (normalizeTraitName(traitName) === wanted) return attribute.value
  }
  return null
}

function normalizeTraitName(value) {
  return value.toLowerCase().replace(/[\s_-]+/g, '')
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

function chunk(values, size) {
  const chunks = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}
