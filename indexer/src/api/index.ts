import { Hono } from 'hono'
import { client, graphql, sql } from 'ponder'
import { db } from 'ponder:api'
import schema, {
  activityEvent,
  payloadWrite,
  protocol,
  sequenceBalance,
  sequenceProtocol,
  sequenceToken,
  sequenceTransfer,
  seaportSale,
  token,
  transfer,
  vesselEntry,
  workUnitBalance,
  workUnitProtocol,
  workUnitTransfer,
} from 'ponder:schema'

const app = new Hono()

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_PAGE_SIZE = 250
const MAX_ACTIVITY_SIZE = 1000
const MAX_WRITE_SIZE = 500
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/

const tokenSortColumns: Record<string, string> = {
  id: 'token_id',
  claimed: 'claimed',
  owner: 'owner',
  type: 'vessel_type',
  filled: 'filled',
  payloadBytes: 'payload_bytes',
  capacityBytes: 'capacity_bytes',
  colorMode: 'color_mode',
  role: 'role',
  claimBlock: 'claim_block',
  entryCount: 'entry_count',
  chosenEntry: 'chosen_entry',
  delegate: 'delegate',
  machineAddress: 'machine',
  chosenMachine: 'chosen_machine',
}

app.use('/sql/*', client({ db, schema }))

app.get('/tokens', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(c.req.query('pageSize')) || 50),
  )
  const offset = (page - 1) * pageSize
  const sortKey = c.req.query('sort') || 'id'
  const sortColumn = tokenSortColumns[sortKey] || tokenSortColumns.id
  const sortDir = c.req.query('dir')?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'
  const includePayload = ['1', 'true', 'yes'].includes(
    (c.req.query('includePayload') || '').toLowerCase(),
  )

  const conds = tokenFilters(c)
  const whereClause = andClause(conds)
  const orderColumn = sql.raw(sortColumn)
  const orderDirection = sql.raw(sortDir)
  const payloadSelect = includePayload
    ? sql`, payload_hex AS "payloadHex"`
    : sql``

  const [countResult, rowsResult] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::integer AS total
      FROM ${token}
      WHERE ${whereClause}
    `),
    db.execute(sql`
      SELECT
        token_id::integer AS id,
        claimed,
        owner,
        vessel_type AS type,
        filled,
        payload_bytes AS "payloadBytes",
        capacity_bytes AS "capacityBytes",
        color_mode AS "colorMode",
        role,
        claim_block AS "claimBlock",
        entry_count AS "entryCount",
        chosen_entry AS "chosenEntry",
        delegate,
        machine AS "machineAddress",
        chosen_machine AS "chosenMachine",
        is_vault AS "isVault",
        is_machine AS "isMachine"
        ${payloadSelect}
      FROM ${token}
      WHERE ${whereClause}
      ORDER BY ${orderColumn} ${orderDirection} NULLS LAST, token_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
  ])

  return c.json({
    rows: normalizeRows(rowsResult).map(normalizeTokenRow),
    total: Number(normalizeRows(countResult)[0]?.total ?? 0),
    page,
    pageSize,
    source: 'ponder',
  })
})

app.get('/tokens/:id{[0-9]+}', async (c) => {
  const id = BigInt(c.req.param('id'))
  const rows = await db
    .select()
    .from(token)
    .where(sql`${token.token_id} = ${id}`)
    .limit(1)
  const row = rows[0]
  if (!row) return c.json({ error: 'token not found' }, 404)

  return c.json({
    ...normalizeTokenRow({
      id: Number(row.token_id),
      claimed: row.claimed,
      owner: row.owner,
      type: row.vessel_type,
      filled: row.filled,
      payloadBytes: row.payload_bytes,
      capacityBytes: row.capacity_bytes,
      colorMode: row.color_mode,
      role: row.role,
      claimBlock: row.claim_block,
      entryCount: row.entry_count,
      chosenEntry: row.chosen_entry,
      delegate: row.delegate,
      machineAddress: row.machine,
      chosenMachine: row.chosen_machine,
      isVault: row.is_vault,
      isMachine: row.is_machine,
      payloadHex: row.payload_hex,
    }),
    locked: row.locked,
    lockBlock: row.lock_block?.toString() ?? null,
    isVault: row.is_vault,
    isMachine: row.is_machine,
    firstClaimedAt: row.first_claimed_at?.toString() ?? null,
    lastPayloadAt: row.last_payload_at?.toString() ?? null,
    lastTransferAt: row.last_transfer_at?.toString() ?? null,
    updatedAt: row.updated_at.toString(),
    blockNumber: row.block_number.toString(),
  })
})

app.get('/grid', async (c) => {
  const result = await db.execute(sql`
    SELECT
      token_id::integer AS id,
      vessel_type AS type,
      payload_hex AS "payloadHex",
      payload_bytes AS "payloadBytes",
      color_mode AS "colorMode"
    FROM ${token}
    WHERE claimed = true
    ORDER BY token_id ASC
  `)

  const rows = normalizeRows(result).map((row) => ({
    id: Number(row.id),
    type: row.type ?? null,
    payloadHex: row.payloadHex,
    payloadBytes: Number(row.payloadBytes ?? 0),
    colorMode: row.colorMode == null ? null : Number(row.colorMode),
  }))

  return c.json({
    rows,
    total: rows.length,
    source: 'ponder',
  })
})

app.get('/tokens/:id{[0-9]+}/entries', async (c) => {
  const id = BigInt(c.req.param('id'))
  const result = await db.execute(sql`
    SELECT
      entry_index AS "entryIndex",
      payload_hex AS "payloadHex",
      payload_bytes AS "payloadBytes",
      tx_hash AS "txHash",
      block_number AS "blockNumber",
      log_index AS "logIndex",
      timestamp
    FROM ${vesselEntry}
    WHERE token_id = ${id}
    ORDER BY entry_index ASC
  `)

  return c.json({
    rows: normalizeRows(result).map((row) => ({
      entryIndex: Number(row.entryIndex),
      payloadHex: row.payloadHex,
      payloadBytes: Number(row.payloadBytes),
      txHash: row.txHash,
      blockNumber: stringify(row.blockNumber),
      logIndex: row.logIndex == null ? null : Number(row.logIndex),
      timestamp: stringify(row.timestamp),
    })),
  })
})

app.get('/tokens/:id{[0-9]+}/writes', async (c) => {
  const id = BigInt(c.req.param('id'))
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const limit = Math.min(
    MAX_WRITE_SIZE,
    Math.max(1, Number(c.req.query('offset') ?? c.req.query('limit')) || 50),
  )
  const offset = (page - 1) * limit
  const sortDir = c.req.query('dir')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const orderDirection = sql.raw(sortDir)

  const [countResult, rowsResult] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::integer AS total
      FROM ${payloadWrite}
      WHERE token_id = ${id}
    `),
    db.execute(sql`
      SELECT
        id,
        token_id AS "tokenId",
        entry_index AS "entryIndex",
        payload_hex AS "payloadHex",
        payload_bytes AS "payloadBytes",
        writer,
        tx_hash AS "txHash",
        block_number AS "blockNumber",
        log_index AS "logIndex",
        timestamp
      FROM ${payloadWrite}
      WHERE token_id = ${id}
      ORDER BY block_number ${orderDirection}, log_index ${orderDirection}
      LIMIT ${limit} OFFSET ${offset}
    `),
  ])

  return c.json({
    rows: normalizeRows(rowsResult).map((row) => ({
      id: row.id,
      tokenId: stringify(row.tokenId),
      entryIndex: row.entryIndex == null ? null : Number(row.entryIndex),
      payloadHex: row.payloadHex,
      payloadBytes: Number(row.payloadBytes),
      writer: row.writer ?? null,
      txHash: row.txHash,
      blockNumber: stringify(row.blockNumber),
      logIndex: row.logIndex == null ? null : Number(row.logIndex),
      timestamp: stringify(row.timestamp),
    })),
    total: Number(normalizeRows(countResult)[0]?.total ?? 0),
    page,
    limit,
  })
})

app.get('/activity', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const limit = Math.min(
    MAX_ACTIVITY_SIZE,
    Math.max(1, Number(c.req.query('offset') ?? c.req.query('limit')) || 50),
  )
  const offset = (page - 1) * limit
  const conds = activityFilters(c)
  const whereClause = andClause(conds)

  const result = await db.execute(sql`
    SELECT
      ${activityEvent}.*,
      ${payloadWrite}.entry_index AS write_entry_index,
      ${seaportSale}.buyer AS sale_buyer,
      ${seaportSale}.seller AS sale_seller,
      ${seaportSale}.payment_token AS sale_payment_token,
      ${seaportSale}.payment_symbol AS sale_payment_symbol,
      ${seaportSale}.payment_decimals AS sale_payment_decimals,
      ${seaportSale}.payment_amount_raw AS sale_payment_amount_raw,
      ${token}.vessel_type AS craft_type,
      ${sequenceToken}.token_id AS sequence_token_id,
      ${sequenceToken}.artist AS sequence_artist,
      ${sequenceToken}.artist_address AS sequence_artist_address,
      ${sequenceToken}.max_supply AS sequence_max_supply,
      ${sequenceToken}.price AS sequence_price,
      ${sequenceToken}.minted AS sequence_minted,
      ${sequenceToken}.locked AS sequence_locked,
      ${sequenceToken}.event_num_start AS sequence_event_num_start,
      ${sequenceToken}.event_num_end AS sequence_event_num_end,
      ${sequenceToken}.uri AS sequence_uri,
      ${sequenceToken}.uses_renderer AS sequence_uses_renderer,
      ${sequenceToken}.renderer AS sequence_renderer,
      ${sequenceToken}.updated_at AS sequence_updated_at,
      ${sequenceToken}.block_number AS sequence_block_number
    FROM ${activityEvent}
    LEFT JOIN ${token}
      ON ${token}.token_id = ${activityEvent}.token_id
    LEFT JOIN ${sequenceToken}
      ON ${activityEvent}.source = 'sequence'
      AND ${sequenceToken}.token_id = ${activityEvent}.subject_id
    LEFT JOIN ${seaportSale}
      ON ${seaportSale}.activity_id = ${activityEvent}.id
    LEFT JOIN ${payloadWrite}
      ON ${activityEvent}.type = 'write'
      AND ${payloadWrite}.token_id = ${activityEvent}.token_id
      AND ${payloadWrite}.tx_hash = ${activityEvent}.tx_hash
      AND ${payloadWrite}.block_number = ${activityEvent}.block_number
      AND ${payloadWrite}.log_index = ${activityEvent}.log_index
    WHERE ${whereClause}
    ORDER BY ${activityEvent}.timestamp DESC, ${activityEvent}.block_number DESC, ${activityEvent}.log_index DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  return c.json(normalizeRows(result).map(activityToExplorerTx))
})

app.get('/activity/daily', async (c) => {
  const conds = activityFilters(c)
  const whereClause = andClause(conds)

  const [rangeResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT
        MIN(timestamp) AS "firstTimestamp",
        MAX(timestamp) AS "lastTimestamp",
        COUNT(*)::integer AS total
      FROM ${activityEvent}
      WHERE ${whereClause}
    `),
    db.execute(sql`
      SELECT
        to_char(to_timestamp(timestamp::double precision) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        COUNT(*)::integer AS count
      FROM ${activityEvent}
      WHERE ${whereClause}
      GROUP BY date
      ORDER BY date ASC
    `),
  ])

  const range = normalizeRows(rangeResult)[0] ?? {}
  const total = Number(range.total ?? 0)
  const today = utcDateKey(new Date())
  const startDate = total > 0 ? utcDateKeyFromSeconds(range.firstTimestamp) : today
  const endDate = today
  const counts = new Map(
    normalizeRows(countResult).map((row) => [
      String(row.date),
      Number(row.count ?? 0),
    ]),
  )
  const days = dailyRange(startDate, endDate).map((date) => ({
    date,
    count: counts.get(date) ?? 0,
  }))

  return c.json({
    startDate,
    endDate,
    total,
    maxCount: Math.max(0, ...days.map((day) => day.count)),
    days,
    source: 'ponder',
  })
})

app.get('/transfers', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const limit = Math.min(
    10_000,
    Math.max(1, Number(c.req.query('offset') ?? c.req.query('limit')) || 1000),
  )
  const offset = (page - 1) * limit
  const address = (c.req.query('address') || '').trim()
  const conds = []
  if (ADDRESS_PATTERN.test(address)) {
    conds.push(sql`(lower("from") = lower(${address}) OR lower("to") = lower(${address}))`)
  }
  const whereClause = andClause(conds)

  const result = await db.execute(sql`
    SELECT
      tx_hash AS hash,
      "from",
      "to",
      token_id AS "tokenID",
      block_number AS "blockNumber",
      timestamp AS "timeStamp"
    FROM ${transfer}
    WHERE ${whereClause}
    ORDER BY block_number DESC, log_index DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  return c.json(
    normalizeRows(result).map((row) => ({
      hash: row.hash,
      from: row.from,
      to: row.to,
      tokenID: stringify(row.tokenID),
      blockNumber: stringify(row.blockNumber),
      timeStamp: stringify(row.timeStamp),
    })),
  )
})

app.get('/holders', async (c) => {
  const limit = Math.min(5_000, Math.max(1, Number(c.req.query('limit')) || 100))
  const result = await db.execute(sql`
    SELECT
      owner AS address,
      COUNT(*)::integer AS count,
      COUNT(*) FILTER (WHERE vessel_type = 'machine')::integer AS machines,
      COUNT(*) FILTER (WHERE vessel_type = 'vault')::integer AS vaults,
      COUNT(*) FILTER (WHERE vessel_type = 'capsule')::integer AS capsules,
      COUNT(*) FILTER (WHERE filled = false)::integer AS empty
    FROM ${token}
    WHERE claimed = true AND owner IS NOT NULL
    GROUP BY owner
    ORDER BY count DESC, owner ASC
    LIMIT ${limit}
  `)

  return c.json({ rows: normalizeRows(result) })
})

app.get('/work-units/balances', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(c.req.query('pageSize') || c.req.query('limit')) || 50),
  )
  const offset = (page - 1) * pageSize
  const address = (c.req.query('address') || '').trim()
  const sortDir = c.req.query('dir')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const conds = [sql`balance > 0`]

  if (ADDRESS_PATTERN.test(address)) {
    conds.push(sql`lower(${workUnitBalance}.address) = lower(${address})`)
  }

  const whereClause = andClause(conds)
  const orderDirection = sql.raw(sortDir)

  const [countResult, rowsResult] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::integer AS total
      FROM ${workUnitBalance}
      WHERE ${whereClause}
    `),
    db.execute(sql`
      SELECT
        address,
        balance,
        updated_at AS "updatedAt",
        block_number AS "blockNumber"
      FROM ${workUnitBalance}
      WHERE ${whereClause}
      ORDER BY balance ${orderDirection}, address ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
  ])

  return c.json({
    rows: normalizeRows(rowsResult).map(normalizeWorkUnitBalanceRow),
    total: Number(normalizeRows(countResult)[0]?.total ?? 0),
    page,
    pageSize,
    source: 'ponder',
  })
})

app.get('/work-units/balances/:address', async (c) => {
  const address = c.req.param('address').trim()
  if (!ADDRESS_PATTERN.test(address)) {
    return c.json({ error: 'invalid address' }, 400)
  }

  const result = await db.execute(sql`
    SELECT
      address,
      balance,
      updated_at AS "updatedAt",
      block_number AS "blockNumber"
    FROM ${workUnitBalance}
    WHERE lower(address) = lower(${address})
    LIMIT 1
  `)

  const row = normalizeRows(result)[0]
  if (!row) {
    return c.json({
      address,
      balance: '0',
      updatedAt: null,
      blockNumber: null,
      source: 'ponder',
    })
  }

  return c.json({
    ...normalizeWorkUnitBalanceRow(row),
    source: 'ponder',
  })
})

app.get('/work-units/transfers', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const limit = Math.min(
    10_000,
    Math.max(1, Number(c.req.query('limit')) || 1000),
  )
  const requestedOffset = c.req.query('offset')
  const offset = requestedOffset == null
    ? (page - 1) * limit
    : Math.max(0, Number(requestedOffset) || 0)
  const address = (c.req.query('address') || '').trim()
  const conds = []
  if (ADDRESS_PATTERN.test(address)) {
    conds.push(sql`(lower("from") = lower(${address}) OR lower("to") = lower(${address}))`)
  }
  const whereClause = andClause(conds)

  const result = await db.execute(sql`
    SELECT
      tx_hash AS hash,
      "from",
      "to",
      value,
      block_number AS "blockNumber",
      timestamp AS "timeStamp"
    FROM ${workUnitTransfer}
    WHERE ${whereClause}
    ORDER BY block_number DESC, log_index DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  return c.json(
    normalizeRows(result).map((row) => ({
      hash: row.hash,
      from: row.from,
      to: row.to,
      value: stringify(row.value),
      blockNumber: stringify(row.blockNumber),
      timeStamp: stringify(row.timeStamp),
    })),
  )
})

app.get('/sequences/tokens', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(c.req.query('pageSize') || c.req.query('limit')) || 50),
  )
  const offset = (page - 1) * pageSize

  const [countResult, rowsResult] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::integer AS total FROM ${sequenceToken}`),
    db.execute(sql`
      SELECT
        token_id AS "tokenId",
        artist,
        artist_address AS "artistAddress",
        max_supply AS "maxSupply",
        price,
        minted,
        locked,
        event_num_start AS "eventNumStart",
        event_num_end AS "eventNumEnd",
        uri,
        uses_renderer AS "usesRenderer",
        renderer,
        updated_at AS "updatedAt",
        block_number AS "blockNumber"
      FROM ${sequenceToken}
      ORDER BY token_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
  ])

  return c.json({
    rows: normalizeRows(rowsResult).map(normalizeSequenceTokenRow),
    total: Number(normalizeRows(countResult)[0]?.total ?? 0),
    page,
    pageSize,
    source: 'ponder',
  })
})

app.get('/sequences/tokens/:id{[0-9]+}', async (c) => {
  const id = BigInt(c.req.param('id'))
  const result = await db.execute(sql`
    SELECT
      token_id AS "tokenId",
      artist,
      artist_address AS "artistAddress",
      max_supply AS "maxSupply",
      price,
      minted,
      locked,
      event_num_start AS "eventNumStart",
      event_num_end AS "eventNumEnd",
      uri,
      uses_renderer AS "usesRenderer",
      renderer,
      updated_at AS "updatedAt",
      block_number AS "blockNumber"
    FROM ${sequenceToken}
    WHERE token_id = ${id}
    LIMIT 1
  `)

  const row = normalizeRows(result)[0]
  if (!row) return c.json({ error: 'sequence token not found' }, 404)
  return c.json({ ...normalizeSequenceTokenRow(row), source: 'ponder' })
})

app.get('/sequences/balances', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(c.req.query('pageSize') || c.req.query('limit')) || 50),
  )
  const offset = (page - 1) * pageSize
  const address = (c.req.query('address') || '').trim()
  const tokenId = (c.req.query('tokenId') || '').trim()
  const includeToken = isTruthy(c.req.query('includeToken'))
  const conds = [sql`balance > 0`]

  if (ADDRESS_PATTERN.test(address)) {
    conds.push(sql`lower(${sequenceBalance}.address) = lower(${address})`)
  }
  if (/^\d+$/.test(tokenId)) {
    conds.push(sql`${sequenceBalance}.token_id = ${BigInt(tokenId)}`)
  }

  const whereClause = andClause(conds)

  const rowsQuery = includeToken
    ? sql`
      SELECT
        ${sequenceBalance}.address,
        ${sequenceBalance}.token_id AS "tokenId",
        ${sequenceBalance}.balance,
        ${sequenceBalance}.updated_at AS "updatedAt",
        ${sequenceBalance}.block_number AS "blockNumber",
        ${sequenceToken}.token_id AS sequence_token_id,
        ${sequenceToken}.artist AS sequence_artist,
        ${sequenceToken}.artist_address AS sequence_artist_address,
        ${sequenceToken}.max_supply AS sequence_max_supply,
        ${sequenceToken}.price AS sequence_price,
        ${sequenceToken}.minted AS sequence_minted,
        ${sequenceToken}.locked AS sequence_locked,
        ${sequenceToken}.event_num_start AS sequence_event_num_start,
        ${sequenceToken}.event_num_end AS sequence_event_num_end,
        ${sequenceToken}.uri AS sequence_uri,
        ${sequenceToken}.uses_renderer AS sequence_uses_renderer,
        ${sequenceToken}.renderer AS sequence_renderer,
        ${sequenceToken}.updated_at AS sequence_updated_at,
        ${sequenceToken}.block_number AS sequence_block_number
      FROM ${sequenceBalance}
      LEFT JOIN ${sequenceToken}
        ON ${sequenceToken}.token_id = ${sequenceBalance}.token_id
      WHERE ${whereClause}
      ORDER BY ${sequenceBalance}.token_id ASC, ${sequenceBalance}.balance DESC, ${sequenceBalance}.address ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    : sql`
      SELECT
        address,
        token_id AS "tokenId",
        balance,
        updated_at AS "updatedAt",
        block_number AS "blockNumber"
      FROM ${sequenceBalance}
      WHERE ${whereClause}
      ORDER BY token_id ASC, balance DESC, address ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `

  const [countResult, rowsResult] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::integer AS total
      FROM ${sequenceBalance}
      WHERE ${whereClause}
    `),
    db.execute(rowsQuery),
  ])

  return c.json({
    rows: normalizeRows(rowsResult).map(normalizeSequenceBalanceRow),
    total: Number(normalizeRows(countResult)[0]?.total ?? 0),
    page,
    pageSize,
    source: 'ponder',
  })
})

app.get('/sequences/transfers', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const limit = Math.min(
    10_000,
    Math.max(1, Number(c.req.query('limit')) || 1000),
  )
  const requestedOffset = c.req.query('offset')
  const offset = requestedOffset == null
    ? (page - 1) * limit
    : Math.max(0, Number(requestedOffset) || 0)
  const address = (c.req.query('address') || '').trim()
  const tokenId = (c.req.query('tokenId') || '').trim()
  const conds = []

  if (ADDRESS_PATTERN.test(address)) {
    conds.push(sql`(lower("from") = lower(${address}) OR lower("to") = lower(${address}) OR lower(operator) = lower(${address}))`)
  }
  if (/^\d+$/.test(tokenId)) {
    conds.push(sql`token_id = ${BigInt(tokenId)}`)
  }

  const whereClause = andClause(conds)

  const result = await db.execute(sql`
    SELECT
      tx_hash AS hash,
      log_index AS "logIndex",
      batch_index AS "batchIndex",
      operator,
      "from",
      "to",
      token_id AS "tokenId",
      value,
      block_number AS "blockNumber",
      timestamp AS "timeStamp"
    FROM ${sequenceTransfer}
    WHERE ${whereClause}
    ORDER BY block_number DESC, log_index DESC, batch_index DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  return c.json(normalizeRows(result).map(normalizeSequenceTransferRow))
})

app.get('/stats', async (c) => {
  const [protocolResult, tokenResult, activityResult, workUnitResult, sequenceResult] = await Promise.all([
    db.execute(sql`SELECT * FROM ${protocol} WHERE id = 'main' LIMIT 1`),
    db.execute(sql`
      SELECT
        COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE claimed = true)::integer AS claimed,
        COUNT(*) FILTER (WHERE filled = true)::integer AS filled,
        COUNT(*) FILTER (WHERE vessel_type = 'machine')::integer AS machines,
        COUNT(*) FILTER (WHERE vessel_type = 'vault')::integer AS vaults,
        COUNT(*) FILTER (WHERE vessel_type = 'capsule')::integer AS capsules,
        COALESCE(SUM(capacity_bytes) FILTER (WHERE claimed = true), 0)::integer AS "claimedCapacityBytes",
        COALESCE(SUM(payload_bytes), 0)::integer AS "filledBytes",
        COUNT(DISTINCT owner) FILTER (WHERE claimed = true AND owner IS NOT NULL)::integer AS "uniqueHolders"
      FROM ${token}
    `),
    db.execute(sql`
      SELECT type, COUNT(*)::integer AS count
      FROM ${activityEvent}
      GROUP BY type
      ORDER BY count DESC
    `),
    db.execute(sql`
      SELECT
        p.token_address AS "tokenAddress",
        p.name,
        p.symbol,
        p.decimals,
        p.total_supply AS "totalSupply",
        p.vessel_collection AS "vesselCollection",
        (
          SELECT COUNT(*)::integer
          FROM ${workUnitBalance}
          WHERE balance > 0
        ) AS "uniqueHolders"
      FROM ${workUnitProtocol} p
      WHERE p.id = 'main'
      LIMIT 1
    `),
    db.execute(sql`
      SELECT
        p.contract_address AS "contractAddress",
        p.vessel_address AS "vesselAddress",
        (SELECT COUNT(*)::integer FROM ${sequenceToken}) AS "tokenCount",
        (SELECT COALESCE(SUM(minted), 0) FROM ${sequenceToken}) AS minted,
        (
          SELECT COUNT(DISTINCT address)::integer
          FROM ${sequenceBalance}
          WHERE balance > 0
        ) AS "uniqueHolders"
      FROM ${sequenceProtocol} p
      WHERE p.id = 'main'
      LIMIT 1
    `),
  ])

  return c.json({
    protocol: normalizeRows(protocolResult)[0] ?? null,
    tokens: normalizeRows(tokenResult)[0] ?? null,
    activity: normalizeRows(activityResult),
    workUnits: normalizeWorkUnitStatsRow(normalizeRows(workUnitResult)[0] ?? null),
    sequences: normalizeSequenceStatsRow(normalizeRows(sequenceResult)[0] ?? null),
  })
})

app.use('/', graphql({ db, schema }))
app.use('/graphql', graphql({ db, schema }))

export default app

type Row = Record<string, unknown>

function normalizeRows(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[]
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: Row[] }).rows
  }
  return []
}

function tokenFilters(c: { req: { query: (key: string) => string | undefined } }) {
  const conds = [sql`true`]
  const search = (c.req.query('search') || '').trim().toLowerCase()
  const ids = parseTokenIds(c.req.query('ids') || '')
  const owner = (c.req.query('owner') || '').trim()
  const delegate = (c.req.query('delegate') || '').trim()

  if (ids.length) {
    conds.push(orClause(ids.map((id) => sql`token_id = ${id}`)))
  }
  if (search) {
    if (/^\d+$/.test(search)) {
      conds.push(sql`token_id = ${BigInt(search)}`)
    } else if (ADDRESS_PATTERN.test(search)) {
      conds.push(sql`lower(owner) = lower(${search})`)
    } else {
      conds.push(sql`false`)
    }
  }
  if (ADDRESS_PATTERN.test(owner)) {
    conds.push(sql`lower(owner) = lower(${owner})`)
  }
  if (ADDRESS_PATTERN.test(delegate)) {
    conds.push(sql`lower(delegate) = lower(${delegate})`)
  }

  const claim = c.req.query('claim') || 'all'
  if (claim === 'claimed') conds.push(sql`claimed = true`)
  if (claim === 'unclaimed') conds.push(sql`claimed = false`)

  const filled = c.req.query('filled') || 'all'
  if (filled === 'filled') conds.push(sql`filled = true`)
  if (filled === 'empty') conds.push(sql`filled = false`)

  const type = c.req.query('type') || 'all'
  if (['capsule', 'vault', 'machine'].includes(type)) {
    conds.push(sql`vessel_type = ${type}`)
  }

  const color = c.req.query('color') || 'all'
  if (/^[0-3]$/.test(color)) {
    conds.push(sql`color_mode = ${Number(color)}`)
  }

  return conds
}

function parseTokenIds(value: string) {
  const ids: bigint[] = []
  const seen = new Set<string>()
  for (const part of value.split(',')) {
    const trimmed = part.trim()
    if (!/^\d+$/.test(trimmed)) continue
    const id = BigInt(trimmed)
    if (id < 1n || id > 10_000n) continue
    const key = id.toString()
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(id)
    if (ids.length >= MAX_PAGE_SIZE) break
  }
  return ids
}

function activityFilters(c: { req: { query: (key: string) => string | undefined } }) {
  const conds = [sql`true`]
  const tokenId = c.req.query('tokenId') || c.req.query('id')
  const address = (c.req.query('address') || '').trim()
  const type = c.req.query('type')
  const types = parseActivityTypes(c.req.query('types'), type)
  const source = c.req.query('source')
  const subjectId = c.req.query('subjectId')
  const startTime = c.req.query('startTime')
  const endTime = c.req.query('endTime')

  if (tokenId && /^\d+$/.test(tokenId)) {
    conds.push(sql`${activityEvent}.token_id = ${BigInt(tokenId)}`)
  }
  if (ADDRESS_PATTERN.test(address)) {
    conds.push(sql`(
      lower(${activityEvent}.actor) = lower(${address})
      OR lower(${activityEvent}."from") = lower(${address})
      OR lower(${activityEvent}."to") = lower(${address})
      OR lower(${activityEvent}.delegate) = lower(${address})
      OR lower(${activityEvent}.machine) = lower(${address})
    )`)
  }
  if (types.length === 1) {
    conds.push(sql`${activityEvent}.type = ${types[0]}`)
  } else if (types.length > 1) {
    conds.push(orClause(types.map((type) => sql`${activityEvent}.type = ${type}`)))
  }
  if (source) conds.push(sql`${activityEvent}.source = ${source}`)
  if (subjectId && /^\d+$/.test(subjectId)) {
    conds.push(sql`${activityEvent}.subject_id = ${BigInt(subjectId)}`)
  }
  if (startTime && /^\d+$/.test(startTime)) {
    conds.push(sql`${activityEvent}.timestamp >= ${BigInt(startTime)}`)
  }
  if (endTime && /^\d+$/.test(endTime)) {
    conds.push(sql`${activityEvent}.timestamp < ${BigInt(endTime)}`)
  }

  return conds
}

function parseActivityTypes(...values: Array<string | undefined>) {
  const types: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    if (!value) continue
    for (const rawType of value.split(',')) {
      const type = rawType.trim().toLowerCase()
      if (!/^[a-z0-9_-]+$/.test(type) || seen.has(type)) continue
      seen.add(type)
      types.push(type)
      if (types.length >= 25) return types
    }
  }

  return types
}

function andClause(conds: ReturnType<typeof sql>[]) {
  if (conds.length === 0) return sql`true`
  return conds.reduce((acc, cond, index) =>
    index === 0 ? cond : sql`${acc} AND ${cond}`,
  )
}

function orClause(conds: ReturnType<typeof sql>[]) {
  if (conds.length === 0) return sql`false`
  const clause = conds.reduce((acc, cond, index) =>
    index === 0 ? cond : sql`${acc} OR ${cond}`,
  )
  return sql`(${clause})`
}

function normalizeTokenRow(row: Row) {
  return {
    id: Number(row.id),
    claimed: Boolean(row.claimed),
    owner: row.owner ?? null,
    type: row.type ?? null,
    filled: Boolean(row.filled),
    payloadBytes: Number(row.payloadBytes ?? 0),
    capacityBytes: Number(row.capacityBytes ?? row.id ?? 0),
    colorMode: row.colorMode == null ? null : Number(row.colorMode),
    role: row.role == null ? null : Number(row.role),
    claimBlock: row.claimBlock == null ? null : Number(row.claimBlock),
    entryCount: row.entryCount == null ? null : Number(row.entryCount),
    chosenEntry: row.chosenEntry == null ? null : Number(row.chosenEntry),
    delegate: row.delegate ?? null,
    machineAddress: row.machineAddress ?? null,
    chosenMachine: row.chosenMachine ?? null,
    isVault: Boolean(row.isVault),
    isMachine: Boolean(row.isMachine),
    ...(row.payloadHex == null ? {} : { payloadHex: row.payloadHex }),
  }
}

function normalizeWorkUnitBalanceRow(row: Row) {
  return {
    address: row.address,
    balance: stringify(row.balance),
    updatedAt: row.updatedAt == null ? null : stringify(row.updatedAt),
    blockNumber: row.blockNumber == null ? null : stringify(row.blockNumber),
  }
}

function normalizeWorkUnitStatsRow(row: Row | null) {
  if (!row) return null
  return {
    tokenAddress: row.tokenAddress ?? null,
    name: row.name ?? null,
    symbol: row.symbol ?? null,
    decimals: row.decimals == null ? null : Number(row.decimals),
    totalSupply: row.totalSupply == null ? null : stringify(row.totalSupply),
    vesselCollection: row.vesselCollection ?? null,
    uniqueHolders: row.uniqueHolders == null ? 0 : Number(row.uniqueHolders),
  }
}

function normalizeSequenceTokenRow(row: Row) {
  return {
    tokenId: stringify(row.tokenId),
    artist: row.artist ?? '',
    artistAddress: row.artistAddress ?? null,
    maxSupply: stringify(row.maxSupply),
    price: stringify(row.price),
    minted: stringify(row.minted),
    locked: Boolean(row.locked),
    eventNumStart: stringify(row.eventNumStart),
    eventNumEnd: stringify(row.eventNumEnd),
    uri: row.uri ?? '',
    usesRenderer: Boolean(row.usesRenderer),
    renderer: row.renderer ?? null,
    updatedAt: row.updatedAt == null ? null : stringify(row.updatedAt),
    blockNumber: row.blockNumber == null ? null : stringify(row.blockNumber),
  }
}

function normalizeSequenceBalanceRow(row: Row) {
  const normalized = {
    address: row.address,
    tokenId: stringify(row.tokenId),
    balance: stringify(row.balance),
    updatedAt: row.updatedAt == null ? null : stringify(row.updatedAt),
    blockNumber: row.blockNumber == null ? null : stringify(row.blockNumber),
  }
  const token = sequenceTokenFromJoinedRow(row)
  return token ? { ...normalized, token } : normalized
}

function normalizeSequenceTransferRow(row: Row) {
  return {
    hash: row.hash,
    logIndex: row.logIndex == null ? null : Number(row.logIndex),
    batchIndex: row.batchIndex == null ? null : Number(row.batchIndex),
    operator: row.operator,
    from: row.from,
    to: row.to,
    tokenId: stringify(row.tokenId),
    value: stringify(row.value),
    blockNumber: stringify(row.blockNumber),
    timeStamp: stringify(row.timeStamp),
  }
}

function normalizeSequenceStatsRow(row: Row | null) {
  if (!row) return null
  return {
    contractAddress: row.contractAddress ?? null,
    vesselAddress: row.vesselAddress ?? null,
    tokenCount: row.tokenCount == null ? 0 : Number(row.tokenCount),
    minted: stringify(row.minted ?? 0),
    uniqueHolders: row.uniqueHolders == null ? 0 : Number(row.uniqueHolders),
  }
}

function activityToExplorerTx(row: Row) {
  const tokenId = row.token_id == null ? null : stringify(row.token_id)
  const action = String(row.type)
  const source = String(row.source || 'vessel')
  const subjectId = row.subject_id == null ? null : stringify(row.subject_id)
  const from = row.actor ?? row.from ?? row.to ?? ZERO_ADDRESS
  const salePrice = salePriceForActivity(row)
  const detail = detailForActivity(action, tokenId, row)
  const sequence = sequenceTokenFromJoinedRow(row)

  const tx = {
    hash: row.tx_hash,
    actor: row.actor ?? null,
    from,
    to: row.to ?? row.delegate ?? row.machine ?? ZERO_ADDRESS,
    timeStamp: stringify(row.timestamp),
    blockNumber: stringify(row.block_number),
    input: '0x',
    isError: '0',
    functionName: functionNameForActivity(action),
    action,
    source,
    subjectType: row.subject_type == null ? (tokenId ? 'craft' : null) : String(row.subject_type),
    subjectId: subjectId ?? tokenId,
    amount: row.amount == null ? null : stringify(row.amount),
    vesselId: tokenId,
    craftType: row.craft_type == null ? null : String(row.craft_type),
    entry: row.entry == null && row.write_entry_index != null ? Number(row.write_entry_index) : row.entry == null ? null : Number(row.entry),
    buyer: row.sale_buyer ?? null,
    seller: row.sale_seller ?? null,
    ...(salePrice ? { salePrice } : {}),
    ...(sequence ? { sequence } : {}),
    detail,
    _action: action,
    _vesselId: tokenId,
    _craftType: row.craft_type == null ? null : String(row.craft_type),
    _detail: detail,
  }

  return tx
}

function functionNameForActivity(action: string) {
  switch (action) {
    case 'claim':
      return 'claim(address,uint256[],bytes,address)'
    case 'write':
      return 'setPayloadHolder(uint256,bytes)'
    case 'delegate':
      return 'setDelegate(uint256,address)'
    case 'machine':
      return 'setMachineHolder(uint256,address)'
    case 'setvaultentry':
      return 'setVaultEntryHolder(uint256,uint256)'
    case 'approval':
      return 'approve(address,uint256)'
    case 'approvalforall':
      return 'setApprovalForAll(address,bool)'
    case 'metadata':
      return 'refreshMetadata(uint256)'
    case 'sale':
      return 'Seaport.OrderFulfilled'
    case 'vwuclaim':
      return 'WorkUnitClaimed(address,uint256,bytes32,bytes32,uint256,uint256)'
    case 'sequencemint':
      return 'TransferSingle/TransferBatch(address,address,address,uint256,uint256)'
    default:
      return action
  }
}

function detailForActivity(action: string, tokenId: string | null, row: Row) {
  const suffix = tokenId ? ` #${tokenId}` : ''
  const amount = row.amount == null ? null : Number(row.amount).toLocaleString()
  const subjectId = row.subject_id == null ? null : stringify(row.subject_id)
  switch (action) {
    case 'claim':
      return `claimed${suffix}`
    case 'write':
      return writeDetail(row, suffix)
    case 'delegate':
      return `delegated${suffix}`
    case 'machine':
      return `set machine on${suffix}`
    case 'setvaultentry':
      return `set entry ${Number(row.entry ?? 0)} on${suffix}`
    case 'transfer':
      return `transferred${suffix}`
    case 'sale':
      return `bought${suffix} from ${shortAddress(String(row.sale_seller ?? ''))} for ${salePriceText(row)}`
    case 'vwuclaim':
      return `claimed ${amount ?? '0'} VWU from${suffix}`
    case 'sequencemint':
      return `minted ${amount ?? '0'}x Sequence${subjectId ? ` #${subjectId}` : ''}`
    case 'role':
      return `set role ${Number(row.role ?? 0)}`
    case 'metadata':
      return `refreshed metadata for${suffix}`
    case 'lock':
      return 'started lock clock'
    default:
      return action
  }
}

function sequenceTokenFromJoinedRow(row: Row) {
  if (row.sequence_token_id == null) return null
  return normalizeSequenceTokenRow({
    tokenId: row.sequence_token_id,
    artist: row.sequence_artist,
    artistAddress: row.sequence_artist_address,
    maxSupply: row.sequence_max_supply,
    price: row.sequence_price,
    minted: row.sequence_minted,
    locked: row.sequence_locked,
    eventNumStart: row.sequence_event_num_start,
    eventNumEnd: row.sequence_event_num_end,
    uri: row.sequence_uri,
    usesRenderer: row.sequence_uses_renderer,
    renderer: row.sequence_renderer,
    updatedAt: row.sequence_updated_at,
    blockNumber: row.sequence_block_number,
  })
}

function writeDetail(row: Row, suffix: string) {
  const bytes = Number(row.payload_bytes ?? 0).toLocaleString()
  const entry = row.entry == null && row.write_entry_index != null ? row.write_entry_index : row.entry
  const entryText = entry == null ? '' : ` to entry ${Number(entry)}`
  return `wrote ${bytes} bytes${entryText} on${suffix}`
}

function stringify(value: unknown) {
  return value == null ? '' : value.toString()
}

function isTruthy(value: unknown) {
  return value === '1' || value === 'true' || value === 'yes'
}

function salePriceForActivity(row: Row) {
  if (String(row.type) !== 'sale') return null
  return {
    amountRaw: row.sale_payment_amount_raw == null ? null : String(row.sale_payment_amount_raw),
    decimals: row.sale_payment_decimals == null ? null : Number(row.sale_payment_decimals),
    symbol: String(row.sale_payment_symbol || 'MIXED'),
    token: row.sale_payment_token == null ? null : String(row.sale_payment_token),
    formatted: salePriceText(row),
  }
}

function salePriceText(row: Row) {
  const raw = row.sale_payment_amount_raw == null ? null : String(row.sale_payment_amount_raw)
  const decimals = row.sale_payment_decimals == null ? null : Number(row.sale_payment_decimals)
  const symbol = String(row.sale_payment_symbol || 'MIXED')
  if (!raw || decimals === null || !Number.isInteger(decimals) || decimals < 0 || !/^\d+$/.test(raw)) {
    return 'mixed payment'
  }
  return `${formatTokenAmount(raw, decimals)} ${symbol}`
}

function formatTokenAmount(raw: string, decimals: number) {
  if (decimals === 0) return raw
  const padded = raw.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals) || '0'
  const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/, '') : ''
  return fraction ? `${whole}.${fraction}` : whole
}

function shortAddress(address: string) {
  if (!ADDRESS_PATTERN.test(address)) return 'unknown'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function utcDateKeyFromSeconds(value: unknown) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return utcDateKey(new Date())
  return utcDateKey(new Date(seconds * 1000))
}

function utcDateKeyToTime(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year || 1970, (month || 1) - 1, day || 1)
}

function dailyRange(startDate: string, endDate: string) {
  const start = utcDateKeyToTime(startDate)
  const end = utcDateKeyToTime(endDate)
  if (start > end) return [endDate]

  const days: string[] = []
  for (let time = start; time <= end; time += 86_400_000) {
    days.push(utcDateKey(new Date(time)))
  }
  return days
}
