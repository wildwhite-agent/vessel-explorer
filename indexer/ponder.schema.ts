import { index, onchainTable, primaryKey } from 'ponder'

export const account = onchainTable('accounts', (t) => ({
  address: t.hex().primaryKey(),
  role: t.integer(),
  first_seen_at: t.bigint().notNull(),
  updated_at: t.bigint().notNull(),
}))

export const protocol = onchainTable('protocol', (t) => ({
  id: t.text().primaryKey(),
  vessel_address: t.hex().notNull(),
  claimed_count: t.bigint().notNull(),
  lock_start: t.bigint().notNull(),
  block_event_0: t.bigint().notNull(),
  block_event_1: t.bigint().notNull(),
  default_machine: t.hex(),
  relics: t.hex(),
  creator_supply_claimed: t.boolean().notNull(),
  updated_at: t.bigint().notNull(),
  block_number: t.bigint().notNull(),
}))

export const token = onchainTable(
  'tokens',
  (t) => ({
    token_id: t.bigint().primaryKey(),
    claimed: t.boolean().notNull(),
    owner: t.hex(),
    vessel_type: t.text().notNull(),
    filled: t.boolean().notNull(),
    payload_hex: t.text().notNull(),
    payload_bytes: t.integer().notNull(),
    capacity_bytes: t.integer().notNull(),
    color_mode: t.integer().notNull(),
    role: t.integer(),
    claim_block: t.bigint(),
    entry_count: t.integer().notNull(),
    chosen_entry: t.integer().notNull(),
    delegate: t.hex(),
    machine: t.hex(),
    chosen_machine: t.hex(),
    locked: t.boolean().notNull(),
    lock_block: t.bigint(),
    is_vault: t.boolean().notNull(),
    is_machine: t.boolean().notNull(),
    first_claimed_at: t.bigint(),
    last_payload_at: t.bigint(),
    last_transfer_at: t.bigint(),
    updated_at: t.bigint().notNull(),
    block_number: t.bigint().notNull(),
  }),
  (table) => ({
    ownerIdx: index('token_owner_idx').on(table.owner),
    claimedIdx: index('token_claimed_idx').on(table.claimed),
    typeIdx: index('token_type_idx').on(table.vessel_type),
    filledIdx: index('token_filled_idx').on(table.filled),
    payloadBytesIdx: index('token_payload_bytes_idx').on(table.payload_bytes),
    colorModeIdx: index('token_color_mode_idx').on(table.color_mode),
    delegateIdx: index('token_delegate_idx').on(table.delegate),
    machineIdx: index('token_machine_idx').on(table.machine),
  }),
)

export const vesselEntry = onchainTable(
  'vessel_entries',
  (t) => ({
    token_id: t.bigint().notNull(),
    entry_index: t.integer().notNull(),
    payload_hex: t.text().notNull(),
    payload_bytes: t.integer().notNull(),
    tx_hash: t.hex(),
    block_number: t.bigint().notNull(),
    log_index: t.integer(),
    timestamp: t.bigint().notNull(),
    updated_at: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.token_id, table.entry_index] }),
    tokenIdx: index('entry_token_idx').on(table.token_id),
  }),
)

export const payloadWrite = onchainTable(
  'payload_writes',
  (t) => ({
    id: t.text().primaryKey(),
    token_id: t.bigint().notNull(),
    entry_index: t.integer(),
    payload_hex: t.text().notNull(),
    payload_bytes: t.integer().notNull(),
    writer: t.hex(),
    tx_hash: t.hex().notNull(),
    block_number: t.bigint().notNull(),
    log_index: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    tokenTimestampIdx: index('payload_write_token_timestamp_idx').on(
      table.token_id,
      table.timestamp,
    ),
  }),
)

export const transfer = onchainTable(
  'transfers',
  (t) => ({
    tx_hash: t.hex().notNull(),
    log_index: t.integer().notNull(),
    block_number: t.bigint().notNull(),
    token_id: t.bigint().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.tx_hash, table.log_index] }),
    tokenIdx: index('transfer_token_idx').on(table.token_id),
    fromIdx: index('transfer_from_idx').on(table.from),
    toIdx: index('transfer_to_idx').on(table.to),
    blockIdx: index('transfer_block_idx').on(table.block_number),
  }),
)

export const seaportSale = onchainTable(
  'seaport_sales',
  (t) => ({
    activity_id: t.text().primaryKey(),
    tx_hash: t.hex().notNull(),
    transfer_log_index: t.integer().notNull(),
    block_number: t.bigint().notNull(),
    token_id: t.bigint().notNull(),
    seaport_address: t.hex().notNull(),
    seaport_log_index: t.integer().notNull(),
    order_hash: t.hex().notNull(),
    buyer: t.hex().notNull(),
    seller: t.hex().notNull(),
    payment_token: t.hex(),
    payment_symbol: t.text().notNull(),
    payment_decimals: t.integer(),
    payment_amount_raw: t.text(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    txIdx: index('seaport_sale_tx_idx').on(table.tx_hash),
    tokenTimestampIdx: index('seaport_sale_token_timestamp_idx').on(
      table.token_id,
      table.timestamp,
    ),
    buyerTimestampIdx: index('seaport_sale_buyer_timestamp_idx').on(
      table.buyer,
      table.timestamp,
    ),
    sellerTimestampIdx: index('seaport_sale_seller_timestamp_idx').on(
      table.seller,
      table.timestamp,
    ),
  }),
)

export const activityEvent = onchainTable(
  'activity_events',
  (t) => ({
    id: t.text().primaryKey(),
    type: t.text().notNull(),
    source_event: t.text().notNull(),
    token_id: t.bigint(),
    actor: t.hex(),
    from: t.hex(),
    to: t.hex(),
    delegate: t.hex(),
    machine: t.hex(),
    role: t.integer(),
    entry: t.integer(),
    payload_bytes: t.integer(),
    tx_hash: t.hex().notNull(),
    block_number: t.bigint().notNull(),
    log_index: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    timestampIdx: index('activity_timestamp_idx').on(table.timestamp),
    typeTimestampIdx: index('activity_type_timestamp_idx').on(
      table.type,
      table.timestamp,
    ),
    tokenTimestampIdx: index('activity_token_timestamp_idx').on(
      table.token_id,
      table.timestamp,
    ),
    actorTimestampIdx: index('activity_actor_timestamp_idx').on(
      table.actor,
      table.timestamp,
    ),
    fromTimestampIdx: index('activity_from_timestamp_idx').on(
      table.from,
      table.timestamp,
    ),
    toTimestampIdx: index('activity_to_timestamp_idx').on(
      table.to,
      table.timestamp,
    ),
  }),
)

export const approval = onchainTable(
  'approvals',
  (t) => ({
    token_id: t.bigint().primaryKey(),
    owner: t.hex().notNull(),
    approved: t.hex(),
    tx_hash: t.hex().notNull(),
    block_number: t.bigint().notNull(),
    log_index: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    updated_at: t.bigint().notNull(),
  }),
  (table) => ({
    ownerIdx: index('approval_owner_idx').on(table.owner),
    approvedIdx: index('approval_approved_idx').on(table.approved),
  }),
)

export const operatorApproval = onchainTable(
  'operator_approvals',
  (t) => ({
    owner: t.hex().notNull(),
    operator: t.hex().notNull(),
    approved: t.boolean().notNull(),
    tx_hash: t.hex().notNull(),
    block_number: t.bigint().notNull(),
    log_index: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    updated_at: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.owner, table.operator] }),
    ownerIdx: index('operator_approval_owner_idx').on(table.owner),
    operatorIdx: index('operator_approval_operator_idx').on(table.operator),
  }),
)

export const workUnitProtocol = onchainTable('work_unit_protocol', (t) => ({
  id: t.text().primaryKey(),
  token_address: t.hex().notNull(),
  name: t.text().notNull(),
  symbol: t.text().notNull(),
  decimals: t.integer().notNull(),
  total_supply: t.bigint().notNull(),
  vessel_collection: t.hex().notNull(),
  updated_at: t.bigint().notNull(),
  block_number: t.bigint().notNull(),
}))

export const workUnitBalance = onchainTable(
  'work_unit_balances',
  (t) => ({
    address: t.hex().primaryKey(),
    balance: t.bigint().notNull(),
    updated_at: t.bigint().notNull(),
    block_number: t.bigint().notNull(),
  }),
  (table) => ({
    balanceIdx: index('work_unit_balance_idx').on(table.balance),
  }),
)

export const workUnitTransfer = onchainTable(
  'work_unit_transfers',
  (t) => ({
    tx_hash: t.hex().notNull(),
    log_index: t.integer().notNull(),
    block_number: t.bigint().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    value: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.tx_hash, table.log_index] }),
    fromIdx: index('work_unit_transfer_from_idx').on(table.from),
    toIdx: index('work_unit_transfer_to_idx').on(table.to),
    blockIdx: index('work_unit_transfer_block_idx').on(table.block_number),
  }),
)
