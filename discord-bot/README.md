# Vessel Discord Bot

Polls the Vessel indexer activity feed and posts new vessel interactions to a
Discord webhook. It also posts a once-daily protocol summary at 3:00 PM New
York time.

The activity bot skips `transfer` and `metadata` events by default, skips rows
without a vessel id, and posts one embed per included activity row. Sales are
included.

## Activity Messages

Each activity is a Discord embed:

- The title is the action label, for example `Claimed`, `Vault write`, or
  `Sale`.
- The title links to the transaction on `https://evm.now/tx/<hash>`.
- The description contains one formatted sentence, a blank line, then the
  Vessel frontend link.
- Actor, craft, seller, and price text are bolded where applicable.
- The image is the Vessel OG image with a cache-busting query string.

Examples:

```text
Title: Vault write

**agent.yougogirl.eth** wrote 2,623 bytes to entry 3 on **vault #2623**

https://vessel.worldcomputer.art/2623

Image: https://vessel.worldcomputer.art/api/og/2623?v=<block-action-id-time>
```

```text
Title: Sale

**buyer.eth** bought **vault #303** from **seller.eth** for **0.00489 ETH**

https://vessel.worldcomputer.art/303
```

ENS names are resolved through `ETH_RPC_URL` for actors and sale sellers.

## Daily Summary

The daily summary covers the previous 24 hour window ending at the configured
New York time. The title is `Day N`, where Day 1 is the first 3:00 PM New York
summary after the Vessel deploy timestamp.

Active-day shape:

```text
Title: Day 105

5 interactions · 4 crafts touched · 3 actors

Claims: 1
Writes: 2
SetMachines: 2

***Protocol***
960 / 10,000 claimed · 428 filled · 159 holders
528,782 / 1,134,080 bytes filled

Image: https://vessel.worldcomputer.art/api/daily-grid?start=<unix>&end=<unix>&v=<cache>
```

Quiet-day shape:

```text
Title: Day 105

No vessel interactions.

***Protocol***
960 / 10,000 claimed · 428 filled · 159 holders
528,782 / 1,134,080 bytes filled
```

The daily summary intentionally has no footer and no extra metadata fields.

## Configuration

Copy `.env.example` to `.env` for local runs or `.env.production` for Kamal
deploys.

```sh
pnpm install
pnpm build
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... pnpm start
```

`START_MODE=latest` records the newest included event on first boot and does
not post historical backlog. Use `START_MODE=backfill` only when you
intentionally want to post the current page of recent indexer activity.

`SEND_LATEST_ON_START=false` and `DAILY_SUMMARY_SEND_LATEST_ON_START=false`
are the production defaults. Turn them on only for one-off testing, then turn
them back off before normal redeploys.

## Required Env

- `DISCORD_WEBHOOK_URL`

## Defaults

- `INDEXER_URL=https://indexer.vessel.worldcomputer.art`
- `VESSEL_BASE_URL=https://vessel.worldcomputer.art`
- `ETH_RPC_URL=https://ethereum-rpc.publicnode.com`
- `POLL_INTERVAL_MS=15000`
- `START_MODE=latest`
- `STATE_FILE=/data/state.json`
- `EXCLUDED_EVENT_TYPES=transfer,metadata`
- `SEND_LATEST_ON_START=false`
- `DAILY_SUMMARY_ENABLED=true`
- `DAILY_SUMMARY_TIMEZONE=America/New_York`
- `DAILY_SUMMARY_HOUR=15`
- `DAILY_SUMMARY_MINUTE=0`
- `DAILY_SUMMARY_WINDOW_HOURS=24`
- `VESSEL_DEPLOYED_AT=2026-02-24T04:59:35.000Z`
- `DAILY_SUMMARY_SEND_LATEST_ON_START=false`

## State

Cursor state is stored in `STATE_FILE`, defaulting to `/data/state.json`.
Kamal mounts persistent state at `/home/deploy/vessel-discord-bot/data:/data`.

The bot only advances its cursor after the Discord webhook send succeeds.
