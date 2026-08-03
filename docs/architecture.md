# Vessel Explorer — Architecture

## Overview

Read-only Nuxt SPA for exploring THE_VESSEL on-chain storage protocol. No wallet connect, no transactions. Runtime token data is served by a Ponder indexer backed by Postgres. The only browser RPC path is the live machine contract read for machine payload/name freshness.

## Contracts

| Contract | Address | Role |
|----------|---------|------|
| THE_VESSEL | `0xECb92Cc7112b80A2234936315BbB493fb48d1463` | ERC721, core protocol |
| Sequences | `0x9423548a957284eD17E55c37c4B6D96e5E63065f` | ERC1155 |
| Renderer | `0x85c7D2933f178A02Ee9AAC0E654094EaDAca48a2` | SVG renderer |
| Router | `0x05680635AeCB8582E7ada2f780e855341B209923` | Default machine router |

## Vessel Types

**Capsule** — single-entry storage. max payload = tokenId bytes. most common type.

**Vault** — append-only. multiple entries tracked by `craftToEntry` (1-based count). entries read via `vaultToEntry(vaultId, entryIdx)`.

**Machine** — programmable. machine contract set via `setMachineHolder`. implements `IMachine`: `name()` and `craftToPayload(uint256)`. renderer pulls bytes from machine contract.

Type detection: `craftToType(tokenId)` returns `"Capsule"`, `"Vault"`, or `"Machine"`.

## Traits

**Relic** — read from the `tokenURI` metadata, so it is only known once a vessel is claimed.

**Axiom** — deterministic. Capacity always equals the token id, and a vessel is an axiom when that capacity is a perfect square (`8100`, `10000`, …), i.e. its render grid is a full square. The indexer derives it in addition to reading the `tokenURI` attribute, so unclaimed vessels stay filterable via `trait=axiom` and machines whose machine contract reverts `tokenURI` do not silently lose the trait. There are 100 axioms in the collection.

## Key Contract Functions

```solidity
// Type & metadata
craftToType(uint256) -> string           // "Capsule", "Vault", "Machine"
craftToRole(uint256) -> uint256          // role value
craftToColorMode(uint256) -> uint256     // 0 = grayscale
craftToClaimed(uint256) -> bool
craftToClaimBlock(uint256) -> uint256
craftToLocked(uint256) -> bool

// Ownership & delegation
ownerOf(uint256) -> address
craftToDelegate(uint256) -> address

// Payload
craftToPayload(uint256) -> bytes
craftToEntry(uint256) -> uint256         // entry count (1-based, vaults)
craftToChosenEntry(uint256) -> uint256   // pinned entry (0 = use latest)
vaultToEntry(uint256, uint256) -> bytes  // specific vault entry

// Machine
craftToMachine(uint256) -> address       // machine contract
craftToMachineStatus(uint256) -> uint256
craftToChosenMachine(uint256) -> uint256

// Protocol
claimedCount() -> uint256                // total claimed
MAX_SUPPLY = 10000
PRICE_PER_UNIT = 0.00001 ETH
BLOCKS_PER_DAY = 7200
```

## Renderer Grid System

```
cols = ceil(sqrt(tokenId))
rows = ceil(tokenId / cols)
```

Mode 0 = grayscale. Each byte = `rgb(v, v, v)`. Pixel at (x, y) = byte at index `y * cols + x`.

Examples: vessel #2623 = 52x51, machine #5246 = 73x72.

## Pages

### `/` — Index
- **Activity feed**: recent vessel interactions (claim, write, transfer, delegate, machine, role, entry) from the Ponder activity endpoint. Hover preview on vessel IDs.
- **Holders tab**: leaderboard sorted by vessel count, including indexed machine/vault/capsule counts.
- **Search**: vessel ID → detail page, address → profile page.
- **[random]**: picks from vessels with known write activity.

### `/[id]` — Vessel Detail
- Type badge (capsule/vault/machine) with color coding
- Metadata: capacity, color mode, claim block, locked status
- Pixel grid with [bytes] toggle and [copy] button
- Entry navigation for vaults (defaults to latest)
- Content detection: SVG (source + rendered), HTML (source + sandboxed iframe with [run]), text (single panel), bytecode (hex dump with offsets), binary (pixel grid only)
- Dynamic OG tags: title = vessel ID, description = type, image = server-generated BMP

### `/address/[addr]` — Profile
- Stats: total vessels, machines, vaults, capsules, empty
- Vessel grid from indexed owned and delegated token rows
- Type-colored hover borders (machine=purple, vault=green, capsule=cyan)

## Data Flow

```
Client                    Server Routes              External
──────                    ─────────────              ────────
pages/*.vue          →    /api/activity.get.ts   →   Ponder /activity
composables/*.ts     →    /api/transfers.get.ts  →   Ponder /transfers
                     →    /api/tokens*.ts        →   Ponder /tokens, /entries, /writes
                     →    /api/holders.get.ts    →   Ponder /holders
                     →    /api/stats.get.ts      →   Ponder /stats
                     →    /api/og/[id].get.ts    →   Ponder /tokens/:id payload
AddressDisplay.vue   →    layers.evm useEns()    →   reverse ENS via mainnet RPC
machine detail       →    (direct browser read)  →   Machine contract name()/craftToPayload()
```

`NUXT_INDEXER_URL` is required for Nuxt server routes. `NUXT_PUBLIC_MACHINE_RPC_URL` is optional and public; it is used only when viewing a machine vessel because machine contracts can change output without THE_VESSEL emitting a payload write event. `NUXT_PUBLIC_EVM_CHAINS_MAINNET_RPCS` is optional and public for `layers.evm` reverse ENS display names; it falls back to the machine RPC, then publicnode, when unset.

The indexer tracks protocol state, all 10,000 tokens, payload writes, vault entries, transfers, approvals, holders, and activity from deployment block `24524524`. Event handlers use block-pinned contract reads so historical replay stores the state as it was at each event.

## Ponder Indexer

The indexer lives in `indexer/` and exposes:

- REST: `/tokens`, `/tokens/:id`, `/tokens/:id/entries`, `/tokens/:id/writes`, `/activity`, `/transfers`, `/holders`, `/stats`
- Ponder built-ins: `/health`, `/ready`, GraphQL, and SQL
- Local Postgres via `indexer/docker-compose.yml`
- Kamal deployment via `indexer/config/deploy.yml` and root `Dockerfile.indexer`

RPC behavior is configured with `PONDER_RPC_URLS_1`,
`PONDER_RPC_FALLBACK_URLS_1`, `PONDER_RPC_REQUESTS_PER_SECOND_1`, and
`PONDER_ETH_GET_LOGS_BLOCK_RANGE_1`. `VESSEL_INDEXER_START_BLOCK` and
`VESSEL_INDEXER_END_BLOCK` exist for bounded local smoke tests only.

## Stack

- Nuxt SPA (`ssr: false`)
- Ponder 0.16 indexer
- @1001-digital/layers.evm for base UI, EVM config, and ENS
- viem for live machine contract reads
- Terminal aesthetic: monospace, dark/light mode, minimal UI
