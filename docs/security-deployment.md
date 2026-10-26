# Security deployment preparation

These changes are prepared locally. This document does not authorize a production
rollout. Coordinate the network, database restart and backup work with the host
operator. Do not use `kamal setup` against the existing installation.

## Behavior and finding coverage

- **VESSEL-01:** previews accept only canonical Vessel IDs 1–10000, look up the
  token before allocation, and propagate missing/upstream errors. PNG output is
  capped at 400×400. GET and HEAD share a byte-bounded cache, deduplicated work and
  concurrency limits. Daily grids call the preview helper directly, so they do
  not exhaust the public preview budget. They reject oversized workloads (more
  than 256 cells, 16 MiB source images, 10 activity pages or a 7-day window),
  stop starting new previews after 30 seconds, and cache one in-flight grid.
  Missing tokens may be omitted; overloads fail the grid instead of hiding cells.
  Media requests have a per-process budget; behind Kamal the
  socket-IP budget is conservatively shared. Add finer client limits at the edge.
- **VESSEL-02:** Hono is pinned and overridden to 4.13.14 throughout Ponder's
  dependency tree. The [maintainer advisory](https://github.com/honojs/hono/security/advisories/GHSA-8j4g-w8fx-2239)
  identifies 4.12.34 as the first fixed version.
- **VESSEL-03:** server asset fetches accept data URIs and HTTPS on exact approved
  hosts, initially `ipfs.io` and `arweave.net`. IPFS/Arweave schemes normalize to
  those gateways. Every redirect is checked, every DNS answer must be public,
  and the connection pins the checked address while retaining TLS verification.
  Media fetches admit four active jobs and at most eight waiting jobs, allowing
  ordinary gallery bursts while rejecting excess work.
  Downloads have a 10-second total deadline, three redirects, 1 MiB metadata /
  8 MiB asset ceilings including HTTP decompression. Embedded gzip scripts are
  limited to 1 MiB each, 4 MiB total and 16 scripts. Final HTML is at most 8 MiB.
- **VESSEL-04:** production requires a separate artwork hostname. Its virtual
  host serves only the media route. Media responses have an opaque-origin CSP
  sandbox even on direct navigation and on mislabeled content. Separate-origin
  redirects preserve bounded `v` and `view` cache versions. Hashed `v` revisions
  also key preview, grid, metadata, download and poster caches, so new notifications
  refresh changed artwork. Unversioned media browser caching is 60 seconds;
  unversioned updates may take several cache intervals to propagate. The iframe
  remains sandboxed. Chromium is removed from the server image; no artwork JS
  executes on the server. Raster posters use bounded Sharp decoding; HTML/SVG
  posters use a static “open to view interactive artwork” PNG. Interactive art
  remains in the visitor's sandbox. External scripts, frames, popups and network
  destinations outside the CSP are intentionally blocked; check supported pieces
  in staging before rollout. Native raster decoding remains in the nonroot
  frontend container with resource limits, not in a separate worker.
- **VESSEL-05:** public `ponder serve` uses `vessel_api`; a separate private
  `ponder start` process uses `vessel_indexer`. The latter listens only on its
  container loopback. Both roles lack all five elevated PostgreSQL role flags.
  The writer can create schemas and temporary staging tables in the dedicated
  `vessel` database, which Ponder
  requires for each deployment. The reader gets SELECT on stable `vessel` views,
  not direct access to `ponder_sync` or deployment schemas. Default privileges
  preserve reads after view replacement. No cluster-wide ownership reassignment
  or alteration of the existing administrator role is performed.

Node 24.22.1 remains pinned. PostgreSQL is pinned to 17.11 (same major version),
which includes the fixes listed in the [PostgreSQL security table](https://www.postgresql.org/support/security/).
Application, worker, bot and database configs now specify memory, CPU and PID
limits. The database uses only the `vessel-data` network; Kamal app roles retain
Kamal's required proxy network. Frontend/bot no longer join `shared`.

## Preconditions

1. Record the currently deployed app image revisions and schemas. The audit
   examined `b1ae196`; this branch began at `9adec8a`, which also contains two
   later poster changes and the patched Node pin. Review the complete diff before
   choosing the release revision. Keep old images and schema names for rollback.
2. Verify a recent off-host backup and restore it into an isolated PostgreSQL
   17.11 instance. Back up roles and the database with patched client tools. The
   existing bind mount is `/home/deploy/vessel-indexer-db/data`; never initialize
   or replace it. No backup or production restore has been performed by this task.
3. Have the host operator create a dedicated `vessel-data` Docker bridge. Only
   the database, public query service and private indexing worker join it. Apply
   host egress restrictions with the operator: deny private/link-local destinations
   for frontend asset traffic while retaining the explicitly configured indexer
   and RPC destinations. The application checks do not replace a host firewall.
4. Provision DNS/TLS for a distinct, cookieless `ARTWORK_HOST`. It must differ
   from `APP_HOST` and must not receive application cookies scoped to a parent
   domain. The frontend config validates that the hostname is present. Set
   `NUXT_INDEXER_URL` to the public HTTPS indexer hostname; a hostname reachable
   only on the removed `shared` network will no longer work.
5. Review any extra asset hosts and add only exact hostnames to
   `SEQUENCE_ASSET_HOSTS`. Redirect destinations also need explicit approval in
   this list. Do not add private endpoints, wildcard hosts or credentialed URLs.
6. In the ignored indexer `.env.production`, prepare `API_DATABASE_URL` using
   `vessel_api` and `INDEXER_DATABASE_URL` using `vessel_indexer`; both target
   `vessel-indexer-db:5432/vessel` on `vessel-data`. Keep passwords private. Set
   `PONDER_VIEWS_SCHEMA=vessel`. Leave `DATABASE_SCHEMA` empty for a new writer
   schema; do not reuse an old build schema. The role preparation SQL assumes
   these exact database/stable-schema names and must be adapted if they differ.
7. Arrange a maintenance window. Pause the old combined indexer and hold bot
   polling while views and credentials change. Bot state must be preserved;
   disabling startup replay remains required. This task never starts the bot.

## Approved rollout procedure

Run these only after the separate deployment approval. Use the existing shared
registry/host credential wrapper. For commands below, start in the repository's
`indexer/` directory when using `vvork-kamal vessel-indexer`.

1. Have the operator stop the old combined indexer, verify the backup, then
   recreate **only** its database accessory from the new configuration:
   `vvork-kamal vessel-indexer accessory reboot db`. Confirm the data mount and
   `vessel-data` network, loopback port 5470, PostgreSQL 17.11 and configured
   limits. An app deploy alone does not update accessories.
2. Copy `sql/prepare-roles.sql` to a private operator location. Run it once through
   an administrator connection to database `vessel`, with `psql -X -v
   ON_ERROR_STOP=1 -f prepare-roles.sql`. It is transactional and repeatable.
   It transfers ownership only in `ponder_sync` and stable `vessel`; old
   deployment schemas retain their owner. Existing stable views can temporarily
   fail until the new writer rebuilds them. Set role passwords with interactive
   `\password vessel_indexer` and `\password vessel_api`, then save the two
   URLs in the ignored environment. Do not put passwords in command arguments.
3. Build/deploy the private writer using
   `vvork-kamal vessel-indexer deploy -c config/deploy.worker.yml`. This separate
   service uses the same image source and only the writer credential. Monitor
   its local `/ready` (inside its container), Ponder sync progress and stable
   view ownership. Wait until indexing is ready and views have switched before
   proceeding; the worker has no proxy readiness gate. Verify its HTTP server
   listens on `127.0.0.1:42069` only.
4. Deploy the public service with `vvork-kamal vessel-indexer deploy`. It now
   runs `ponder serve` with only `API_DATABASE_URL`, no indexing/RPC credentials.
   Verify `/ready`, `/tokens?pageSize=1`, GraphQL and a normal SQL read on both
   configured indexer hostnames. Verify the current connection's five privilege
   flags are false without printing the connection string. Check that the API
   role cannot write even after `SET default_transaction_read_only=off` in an
   isolated validation transaction.
5. Deploy the frontend with `vvork-kamal vessel-frontend deploy`. Verify its UID
   is nonzero, no Chromium binary exists, and memory/CPU/PID limits are applied.
   Check valid OG GET/HEAD requests, missing-token status, normal sequence pages,
   raster and static fallback posters. On the artwork hostname, app/API routes
   other than media must return 404. Check direct HTML/SVG response CSP and the
   sandbox's blocked storage access using harmless fixtures. Check supported
   existing artwork visually; do not run attack payloads against production.
6. The host operator applies the bot container limits in its next approved
   rollout, preserving `/home/deploy/vessel-discord-bot/data`. Resume polling only
   after indexer health and continuity are confirmed. No test webhook or startup
   replay is part of this procedure.
7. After successful verification, remove the old superuser connection string
   from application configuration and retire old containers that retain it.
   Keep the administrator credential in the operator secret store. The host
   operator verifies network membership/egress, proxy header/client rate limits,
   monitoring and backups. Old schemas/images may be pruned only after the
   rollback retention window, with a separate reviewed cleanup.

## Rollback

Keep the patched database minor version unless the database operator identifies a
specific incompatibility; do not automatically downgrade its data directory.
Do not drop new roles, schemas or volumes to roll back an application.

Stop the new private writer before restoring the old combined service, so two
writers do not compete to replace stable views. Restore the previous app config,
image and environment from the recorded revision. The old administrator can
still operate the existing schemas; ownership transfer did not demote it. Restore
stable views to the recorded old deployment schema using Ponder's `create-views`
command with `--schema=<recorded-old-schema> --views-schema=vessel` if needed,
then verify reads and readiness before resuming polling. Restoring the old image
also restores the audited weaknesses: prefer holding affected endpoints offline
or rolling forward with a correction. Coordinate any temporary network changes
with the host operator. Preserve bot state throughout.

## Local validation

- `pnpm --dir frontend test:security` (install the matching Playwright Chromium,
  or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a local test browser).
- `pnpm --dir frontend typecheck`; `NITRO_PRESET=node-server pnpm --dir frontend build`.
- `pnpm --dir indexer test:security`; `pnpm --dir indexer typecheck`.
- Build `Dockerfile.frontend` and `Dockerfile.indexer` with their frozen pnpm locks.
- In a disposable database named `vessel`, run `indexer/sql/prepare-roles.sql`
  twice, then `indexer/test/database-roles.sql`. The fixture rolls back and tests
  reader write/DDL denial, writer privilege limits and replaced-view grants.
- Optional local API smoke: create a disposable DB at `127.0.0.1:55471`, prepare
  roles, run `node indexer/test/create-api-fixture.mjs`, then start `ponder serve`
  with the local `vessel_api` URL and schema `vessel`. The fixture creates empty
  tables from the actual Ponder schema. Test readiness, REST, GraphQL, SQL and
  ordinary CORS. Use a loopback dummy RPC URL; `serve` skips RPC diagnostics.
  Never point fixture scripts at a production database.

Production migration/indexing, DNS/TLS, host egress, backup restore and live
artwork compatibility remain rollout checks. Other dependency scanner matches
were not established as reachable vulnerabilities and are outside these five
fixes; this is not a claim that the entire dependency graph is advisory-free.
