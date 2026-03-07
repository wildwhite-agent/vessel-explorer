# Vessel Explorer

A Nuxt 3 single-page application for exploring THE_VESSEL on-chain storage protocol on Ethereum. Browse vessels (capsules, vaults, and machines), view their pixel-rendered payloads, inspect raw bytes, and explore holder leaderboards — all read directly from the blockchain with a minimal terminal aesthetic.

## Tech Stack

- **[Nuxt 3](https://nuxt.com/)** — Vue 3 framework (SPA mode)
- **[@1001-digital/layers.evm](https://www.npmjs.com/package/@1001-digital/layers.evm)** — wallet connect, ENS resolution, dark/light mode
- **[wagmi](https://wagmi.sh/) / [viem](https://viem.sh/)** — contract reads and Ethereum interaction
- **[Etherscan API](https://docs.etherscan.io/)** — transaction history and transfer data

## Setup

```bash
git clone <repo-url>
cd vessel-explorer/frontend
cp .env.example .env
```

Edit `.env` and fill in your keys:

- `NUXT_ETHERSCAN_KEY` — Etherscan API key (required for activity feed and holder data)
- `NUXT_PUBLIC_EVM_WALLET_CONNECT_PROJECT_ID` — WalletConnect project ID (optional)
- `NUXT_PUBLIC_EVM_CHAINS_MAINNET_RPC1/2/3` — Ethereum RPC endpoints (defaults provided)

Install dependencies and start the dev server:

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
      PixelRender.vue         # pixel render via <img> data URL
      ContentView.vue         # text/SVG/HTML/bytecode content viewer
      HexDump.vue             # hex dump display
      AddressDisplay.vue      # address with ENS resolution
    composables/
      useVesselReader.ts      # reads all vessel metadata from contract
    utils/
      vessel.ts               # ABI, hex/pixel helpers, ownership computation
      etherscan.ts            # etherscan API + tx decoding
      content.ts              # content type detection (SVG, HTML, text, bytecode)
    assets/css/
      main.pcss               # global styles, CSS custom properties
  server/api/
    activity.get.ts           # proxied etherscan activity endpoint
    transfers.get.ts          # proxied etherscan transfers endpoint
```

## Key Contracts

- **THE_VESSEL**: [`0xECb92Cc7112b80A2234936315BbB493fb48d1463`](https://etherscan.io/address/0xECb92Cc7112b80A2234936315BbB493fb48d1463)
- **Renderer**: [`0x85c7D2933f178A02Ee9AAC0E654094EaDAca48a2`](https://etherscan.io/address/0x85c7D2933f178A02Ee9AAC0E654094EaDAca48a2)
- **Sequences (ERC1155)**: [`0x9423548a957284eD17E55c37c4B6D96e5E63065f`](https://etherscan.io/address/0x9423548a957284eD17E55c37c4B6D96e5E63065f)

## License

MIT
