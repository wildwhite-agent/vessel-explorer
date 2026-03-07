# Vessel Explorer — Architecture

## Overview

Read-only Nuxt 3 SPA for exploring THE_VESSEL on-chain storage protocol. No wallet connect, no transactions. All data read from Ethereum mainnet via public RPC + Etherscan API.

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
- **Activity feed**: recent vessel interactions (claim, write, transfer, delegate, machine, role, entry). Decoded from etherscan API. Hover preview on vessel IDs.
- **Holders tab**: leaderboard sorted by vessel count. Progressive type enrichment via `craftToType` RPC calls.
- **Search**: vessel ID → detail page, address/ENS → profile page.
- **[random]**: picks from vessels with known write activity.

### `/[id]` — Vessel Detail
- Type badge (capsule/vault/machine) with color coding
- Metadata: capacity, color mode, claim block, locked status
- Pixel grid with [bytes] toggle and [copy] button
- Entry navigation for vaults (defaults to latest)
- Content detection: SVG (source + rendered), HTML (source + sandboxed iframe with [run]), text (single panel), bytecode (hex dump with offsets), binary (pixel grid only)
- Dynamic OG tags: title = vessel ID, description = type, image = server-generated BMP

### `/address/[addr]` — Profile
- ENS resolution
- Stats: total vessels, machines, vaults, capsules, empty
- Vessel grid with progressive payload loading
- Type-colored hover borders (machine=purple, vault=green, capsule=cyan)

## Data Flow

```
Client                    Server Routes              External
──────                    ─────────────              ────────
pages/*.vue          →    /api/activity.get.ts   →   Etherscan v2 API
composables/*.ts     →    /api/transfers.get.ts  →   Etherscan v2 API
                     →    /api/og/[id].get.ts    →   Ethereum RPC (payload → BMP)
readContract()       →    (direct)               →   Ethereum RPC
```

Etherscan API key is server-side only (`NUXT_ETHERSCAN_KEY`, no `PUBLIC` prefix). RPC calls go direct from client via wagmi/viem.

## Stack

- Nuxt 3 SPA (`ssr: false`)
- @1001-digital/layers.evm (ENS resolution, dark/light mode, wagmi config)
- viem for contract reads
- Etherscan v2 API (server-proxied, key not exposed to client)
- Terminal aesthetic: monospace, dark/light mode, minimal UI
