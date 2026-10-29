# Ponder live-query cleanup

The Ponder 0.16.6 patch preserves the database format, SQL validator, read-only
transactions and query timeouts. It applies to both TypeScript source and the
shipped ESM runtime. The same cleanup has been validated in the DAV indexer.

- Release subscription slots exactly once for setup errors, invalid requests,
  stream completion, refresh failures and aborts.
- Wake an aborted stream without waiting for a new indexed block, including
  queries without table references.
- Reduce read-only pool work memory from 512 MiB to 16 MiB per operation.

`test/ponder-live.test.mjs` exercises the installed middleware and real parser.
The unpatched dependency fails after 1000 malformed requests. Regression checks
cover all setup failure paths, the active-stream cap and abort cleanup. Remove
this patch only after a replacement release passes those checks.

Docker copies the patch before frozen dependency installation. The pnpm lockfile
records its content hash, so local and deployed runtime behavior stays aligned.

Abort waits are recreated for each table update and released afterward. This
prevents a lifetime cancellation promise from retaining completed races for
long-lived subscriptions; the regression keeps 50 streams open for 4,000
notifications and checks post-GC heap growth before disconnect.
