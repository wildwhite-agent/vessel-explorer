# Vessel Explorer — Architecture

## Contracts

- **THE_VESSEL**: `0xECb92Cc7112b80A2234936315BbB493fb48d1463` (ERC721)
- **Sequences (ERC1155)**: `0x9423548a957284eD17E55c37c4B6D96e5E63065f`
- **Renderer**: `0x85c7D2933f178A02Ee9AAC0E654094EaDAca48a2`
- **Router**: `0x05680635AeCB8582E7ada2f780e855341B209923`

## Vessel Types

### Capsule (most common)
- Payload overwrites entry 0
- Max payload size = tokenId bytes
- Small IDs (1-262, etc.)

### Vault
- Append-only storage
- Multiple entries (craftToEntry[id] tracks count)
- Large IDs (e.g. 2623)

### Machine
- Has a machine contract set via `setMachineHolder(tokenId, machineAddress)`
- Machine implements IMachine: `name() -> string`, `craftToPayload(uint256) -> bytes`
- Renderer pulls bytes from machine contract instead of stored payload
- IDs like 50, 100, 5246

## Key Contract Functions

```solidity
// Ownership
ownerOf(uint256 tokenId) -> address
getDelegate(uint256 tokenId) -> address

// Payload
craftToPayload(uint256 tokenId) -> bytes        // stored payload
craftToEntry(uint256 tokenId) -> uint256         // entry count (1-based)
vaultToEntry(uint256 vaultId, uint256 entryIdx) -> bytes  // specific entry

// Machine
getMachineHolder(uint256 tokenId) -> address     // machine contract address (0x0 if not a machine)

// Renderer
craftToSVG(uint256 tokenId) -> string            // renders to SVG (high gas, may fail on free RPCs)
```

## Renderer Grid System
- Grid: `ceil(sqrt(tokenId))` columns
- Rows: `ceil(tokenId / cols)`
- Mode 0 = grayscale: each byte = rgb(v, v, v)
- Pixel at (x, y) = byte at index (y * cols + x)

## Pages

### `/` — Index
- Live feed of recent vessel interactions (etherscan API, token transfers + PayloadSet events)
- Search bar: enter vessel ID or ENS name
- Quick stats: total vessels, recent activity

### `/[id]` — Vessel Detail
- Type badge: [capsule] [vault] [machine]
- Owner + delegate (with ENS resolution)
- Two tabs:
  1. **Bytes**: raw hex data, entry list for vaults, payload source info for machines
  2. **Rendered**: SVG render of the vessel (client-side pixel rendering, same as diary machine)
- For machines: link to machine contract, show IMachine name()
- For vaults: entry timeline with thumbnails

## Stack
- Nuxt 3 SPA
- @1001-digital/layers.evm (wallet connect, dark/light mode)
- Terminal aesthetic matching contract-reader
- Etherscan v2 API for transaction history
- viem for contract reads
