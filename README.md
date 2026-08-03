# Vessel Explorer

A read-only explorer for [THE_VESSEL](https://evm.now/address/0xECb92Cc7112b80A2234936315BbB493fb48d1463), an on-chain storage protocol on Ethereum by [@stephensantoro_](https://x.com/stephensantoro_) and [@producedbydav](https://x.com/producedbydav). Browse vessels (capsules, vaults, and machines), view pixel-rendered payloads, inspect raw bytes, detect content types (SVG, HTML, bytecode), follow indexed activity and sales, and explore holder leaderboards from the Ponder indexer.

## Tech Stack

- **[Nuxt 4](https://nuxt.com/)** — Vue framework (SPA mode)
- **[Ponder](https://ponder.sh/)** — production indexer for token state, payload writes, transfers, holders, and activity
- **[@1001-digital/layers.evm](https://www.npmjs.com/package/@1001-digital/layers.evm)** — base UI layer plus EVM/ENS composables
- **[viem](https://viem.sh/)** — live browser reads for machine contract payloads
- **[@visualizevalue/img-grid](https://www.npmjs.com/package/@visualizevalue/img-grid)** — daily Discord summary grid images
- **Discord webhook bot** — activity notifications and daily protocol summaries

Read-only. No wallet connect, no transactions.

## Setup

Run the frontend at `http://127.0.0.1:3001`.

### Frontend

```bash
git clone <repo-url>
cd vessel-explorer/frontend
cp .env.example .env
pnpm install
pnpm dev
```

Edit `.env` before starting the frontend if needed:

- `NUXT_INDEXER_URL` points the frontend server routes at the Ponder indexer.
- `NUXT_PUBLIC_MACHINE_RPC_URL` is the optional public browser RPC used only for live machine payload/name reads.
- `NUXT_PUBLIC_EVM_CHAINS_MAINNET_RPCS` is the optional public read RPC used by `layers.evm` for ENS; it falls back to the machine RPC, then publicnode, when unset.

### Ponder Indexer

The production data source lives in `indexer/`. It backfills THE_VESSEL from
deployment block `24524524`, seeds all 10,000 tokens, stores payload bytes and
vault entries at write time, and exposes REST routes used by the Nuxt app.

```bash
cd vessel-explorer/indexer
cp .env.local.example .env.local
docker compose up -d
pnpm install
pnpm codegen
pnpm dev
```

Point the frontend at it with:

```bash
NUXT_INDEXER_URL=http://127.0.0.1:42069 pnpm dev
```

For bounded local smoke tests, set `VESSEL_INDEXER_START_BLOCK` and
`VESSEL_INDEXER_END_BLOCK`. Do not set those for a production full sync.

### Discord Bot

The Discord bot lives in `discord-bot/`. It polls the indexer `/activity`
endpoint, skips transfers and metadata refreshes by default, posts one embed
per included Vessel interaction, and sends the daily summary.

```bash
cd vessel-explorer/discord-bot
cp .env.example .env
pnpm install
pnpm build
pnpm start
```

## Project Structure

```
frontend/
  app/
    pages/
      index.vue              # activity feed, holders leaderboard, search
      all.vue                # Ponder-backed all-vessels table
      grid.vue               # zoomable 100x100 all-vessels grid
      [id].vue               # vessel detail (pixel grid, metadata, content view)
      address/[addr].vue     # address profile (owned vessels grid)
    components/
      ActivityHeatmap.vue     # homepage activity heatmap
      AppHeader.vue           # site header with dark/light toggle
      PixelGrid.vue           # interactive pixel grid (cell-level rendering)
      PixelRender.vue         # simple pixel render via data URL
      ContentView.vue         # content viewer (text, SVG, HTML with [run], bytecode hex dump)
      HexDump.vue             # raw hex dump
      AddressDisplay.vue      # address links and shortening
      WritePayloadPreview.vue # payload preview for historical writes
    composables/
      useVesselReader.ts      # reads vessel metadata, payload, entries from the indexer
      useOwnership.ts         # indexer-backed current ownership
      useHeaderStats.ts       # indexer-backed protocol header stats
    utils/
      vessel.ts               # grid math, pixel helpers, formatting
      activity.ts             # indexer-backed activity and transfer helpers
      indexer.ts              # token, holder, and grid API helpers
      machine.ts              # live machine contract reads
      content.ts              # content type detection (SVG, HTML, text, bytecode, binary)
  server/api/
    activity.get.ts           # Ponder activity API proxy
    activity/daily.get.ts     # daily activity aggregate proxy
    daily-grid.get.ts         # Discord daily touched-crafts grid image
    grid.get.ts               # compact all-vessels grid snapshot
    holders.get.ts            # holder leaderboard proxy
    stats.get.ts              # protocol stats proxy
    tokens.get.ts             # Ponder token API proxy
    tokens/[id].get.ts        # single token proxy
    tokens/[id]/entries.get.ts # token entries proxy
    tokens/[id]/writes.get.ts # token write history proxy
    transfers.get.ts          # Ponder transfer API proxy
    og/[id].get.ts            # dynamic OG image from indexed payload
indexer/
  ponder.config.ts            # mainnet chain, RPC load balancing, start/end override
  ponder.schema.ts            # protocol, token, entry, payload, sale, work-unit, sequence tables
  src/index.ts                # event handlers, block-pinned reads, metadata refresh
  src/api/index.ts            # REST, SQL, GraphQL routes
  src/seaport.ts              # Seaport sale parsing from Vessel transfer receipts
  config/deploy.yml           # Kamal deployment with Postgres accessory
discord-bot/
  src/index.ts                # bot entrypoint
  src/bot.ts                  # polling loop and cursor handling
  src/discord.ts              # Discord embed formatting and webhook sends
  src/summary.ts              # daily summary schedule and payloads
  config/deploy.yml           # Kamal deployment without public proxy
```

## Pages

- **`/`** — activity feed (claims, writes, transfers, delegates, machines), holders leaderboard, search by vessel ID or address
- **`/all`** — table of all vessel token IDs with Ponder-backed filtering/sorting
- **`/grid`** — zoomable 100x100 grid of all vessels with claimed/type/payload rendering
- **`/[id]`** — vessel detail with pixel grid, metadata (type, capacity, color mode, claim block), entry navigation for vaults, content detection (renders SVG/HTML, shows bytecode hex dumps), [bytes] toggle, [copy] button
- **`/address/[addr]`** — profile page with owned vessels grid, type stats (machines/vaults/capsules/empty), progressive payload loading

## Key Contracts

- **THE_VESSEL**: [`0xECb92Cc7112b80A2234936315BbB493fb48d1463`](https://evm.now/address/0xECb92Cc7112b80A2234936315BbB493fb48d1463)
- **Renderer**: [`0x85c7D2933f178A02Ee9AAC0E654094EaDAca48a2`](https://evm.now/address/0x85c7D2933f178A02Ee9AAC0E654094EaDAca48a2)
- **Shipyard Work Unit (ERC20)**: [`0x476072a4e9648c1a115f47f268353586b0012c97`](https://evm.now/address/0x476072a4e9648c1a115f47f268353586b0012c97)
- **Sequences (ERC1155)**: [`0x9423548a957284eD17E55c37c4B6D96e5E63065f`](https://evm.now/address/0x9423548a957284eD17E55c37c4B6D96e5E63065f)

## Vessel Types

| Type | Description |
|------|-------------|
| Capsule | Single-entry storage, payload size = tokenId bytes |
| Vault | Append-only, multiple entries |
| Machine | Programmable, delegates rendering to an IMachine contract |

## Vessel Traits

| Trait | Description |
|-------|-------------|
| Axiom | Capacity is a perfect square (100 of them). Derived from the token id, so unclaimed axioms are filterable on `/all` before they are claimed |
| Relic | Read from `tokenURI` metadata, known only after a claim |

## Renderer

Grid dimensions: `cols = ceil(sqrt(tokenId))`, `rows = ceil(tokenId / cols)`. Mode 0 = grayscale: each byte maps to `rgb(v, v, v)`.

## License

MIT
