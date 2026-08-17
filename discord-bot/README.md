# Vessel Discord Bot

Polls the Vessel indexer activity feed and posts new vessel interactions to a
Discord webhook. It also posts a once-daily protocol summary at 3:00 PM New
York time, and can poll Convex for new visualizer projects.

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

## Optional Env

- `DISCORD_PROJECT_WEBHOOK_URL` — visualizer project announcements

## Defaults

- `INDEXER_URL=https://indexer.vessel.worldcomputer.art`
- `VESSEL_BASE_URL=https://vessel.worldcomputer.art`
- `VISUALIZER_BASE_URL=https://visualizer.thevessel.fun`
- `CONVEX_URL=https://festive-hummingbird-510.convex.cloud`
- `CONVEX_UPCOMING_QUERY=upcoming:listAnnouncements`
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

## Visualizer announcements

When `DISCORD_PROJECT_WEBHOOK_URL` is set, the same poll loop also queries Convex
`upcoming:listAnnouncements` with a persisted `afterCreatedAt` watermark and posts
new visualizer projects to that webhook (channel `1538952605789855844`). Activity
and daily summary keep using `DISCORD_WEBHOOK_URL`.

Each visualizer embed is:

- Title: project `title` (links to `VISUALIZER_BASE_URL` + `exploreUrl`)
- Date: `date` (`YYYY-MM-DD` or `TBD`)
- Artist: `artist`

On first boot the bot persists `upcomingAfterCreatedAt` as `Date.now()` and polls
`{ afterCreatedAt }` — never `0` and never without the argument. Existing dashboard
projects stay quiet until a new one is added. After a successful post, the
watermark becomes the max `createdAt` from that page. Only `status === "success"`
with an array is handled.

Leave `DISCORD_PROJECT_WEBHOOK_URL` empty to disable this poller.

Create the incoming webhook in the visualizer Discord channel and treat the URL
as a secret. Do not reuse the activity webhook.
