# Vessel Explorer

A read-only explorer for [THE_VESSEL](https://etherscan.io/address/0xECb92Cc7112b80A2234936315BbB493fb48d1463), an on-chain storage protocol on Ethereum by [Stephen Santoro](https://x.com/stevesantoro) and [Produced By Duff](https://x.com/producedbyduff). Browse vessels (capsules, vaults, and machines), view pixel-rendered payloads, inspect raw bytes, detect content types (SVG, HTML, bytecode), and explore holder leaderboards — all read directly from the blockchain.

## Tech Stack

- **[Nuxt 3](https://nuxt.com/)** — Vue 3 framework (SPA mode)
- **[@1001-digital/layers.evm](https://www.npmjs.com/package/@1001-digital/layers.evm)** — ENS resolution, dark/light mode, wagmi/viem config
- **[viem](https://viem.sh/)** — contract reads via public RPC
- **[Etherscan API v2](https://docs.etherscan.io/)** — transaction history, transfer data (server-side proxied)

Read-only. No wallet connect, no transactions.

## Setup

```bash
git clone <repo-url>
cd vessel-explorer/frontend
cp .env.example .env
```

Edit `.env`:

- `NUXT_ETHERSCAN_KEY` — Etherscan API key (required for activity feed and holder data)
- `NUXT_PUBLIC_EVM_CHAINS_MAINNET_RPC1/2/3` — Ethereum RPC endpoints (defaults provided)

```bash
npm install
npm run dev
```

## Project Structure

```
frontend/
  app/
    pages/
      index.vue              # activity feed, holders leaderboard, search
      [id].vue               # vessel detail (pixel grid, metadata, content view)
      address/[addr].vue     # address profile (owned vessels grid)
    components/
      AppHeader.vue           # site header with dark/light toggle
      PixelGrid.vue           # interactive pixel grid (cell-level rendering)
      PixelRender.vue         # simple pixel render via data URL
      ContentView.vue         # content viewer (text, SVG, HTML with [run], bytecode hex dump)
      HexDump.vue             # raw hex dump
      AddressDisplay.vue      # address with ENS resolution + etherscan links
    composables/
      useVesselReader.ts      # reads vessel metadata, payload, entries from contract
      useOwnership.ts         # transfer replay to compute current ownership
    utils/
      vessel.ts               # ABI (30+ functions), grid math, pixel helpers
      etherscan.ts            # etherscan API fetch + tx decoding
      content.ts              # content type detection (SVG, HTML, text, bytecode, binary)
  server/api/
    activity.get.ts           # etherscan activity proxy (keeps API key server-side)
    transfers.get.ts          # etherscan transfers proxy
    og/[id].get.ts            # dynamic OG image: grayscale BMP from on-chain payload
```

## Pages

- **`/`** — live activity feed (claims, writes, transfers, delegates, machines), holders leaderboard with progressive type enrichment, search by vessel ID or address/ENS
- **`/[id]`** — vessel detail with pixel grid, metadata (type, capacity, color mode, claim block), entry navigation for vaults, content detection (renders SVG/HTML, shows bytecode hex dumps), [bytes] toggle, [copy] button
- **`/address/[addr]`** — profile page with owned vessels grid, type stats (machines/vaults/capsules/empty), progressive payload loading

## Key Contracts

- **THE_VESSEL**: [`0xECb92Cc7112b80A2234936315BbB493fb48d1463`](https://etherscan.io/address/0xECb92Cc7112b80A2234936315BbB493fb48d1463)
- **Renderer**: [`0x85c7D2933f178A02Ee9AAC0E654094EaDAca48a2`](https://etherscan.io/address/0x85c7D2933f178A02Ee9AAC0E654094EaDAca48a2)
- **Sequences (ERC1155)**: [`0x9423548a957284eD17E55c37c4B6D96e5E63065f`](https://etherscan.io/address/0x9423548a957284eD17E55c37c4B6D96e5E63065f)

## Vessel Types

| Type | Description |
|------|-------------|
| Capsule | Single-entry storage, payload size = tokenId bytes |
| Vault | Append-only, multiple entries |
| Machine | Programmable, delegates rendering to an IMachine contract |

## Renderer

Grid dimensions: `cols = ceil(sqrt(tokenId))`, `rows = ceil(tokenId / cols)`. Mode 0 = grayscale: each byte maps to `rgb(v, v, v)`.

## License

MIT
