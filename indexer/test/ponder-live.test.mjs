import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { client, onchainTable } from "ponder";
const turn = () => new Promise((resolve) => setImmediate(resolve));
const queryUrl = (sql, path = "live") => `/sql/${path}?sql=${encodeURIComponent(JSON.stringify({ json: { sql, params: [] } }))}`;
// Exercise installed Ponder, its SQL validator and real Hono streams. Only
// database results and the process lifecycle are synthetic; no network or RPC.
async function fixture() {
  let notify = () => {
  };
  let execute = async (_sql) => ({
    rows: [{ id: 1 }]
  });
  const session = {
    dialect: {},
    prepareQuery: (query) => ({
      execute: () => execute(query.sql)
    })
  };
  Object.assign(globalThis, {
    PONDER_COMMON: {
      apiShutdown: { isKilled: false },
      logger: { debug() {
      } }
    },
    PONDER_NAMESPACE_BUILD: { schema: "test" },
    PONDER_PRE_BUILD: {},
    PONDER_DATABASE: {
      driver: {
        dialect: "pglite",
        instance: {
          query: async () => {
          },
          onNotification: (fn) => {
            notify = fn;
          }
        }
      },
      readonlyQB: { wrap: async () => true }
    }
  });
  const schema = {
    items: onchainTable("items", (t) => ({ id: t.integer().primaryKey() }))
  };
  const db = { _: { session } };
  const app = new Hono();
  app.onError(() => new Response("Internal error", { status: 500 }));
  app.use("/sql/*", client({ db, schema }));
  await turn();
  return {
    app,
    setExecute: (fn) => {
      execute = fn;
    },
    notify: () => notify("test", '["items"]')
  };
}
test("failed live requests never consume subscription slots", async () => {
  const { app, setExecute } = await fixture();
  const cases = [
    ["/sql/live", 400],
    ["/sql/live?sql=not-json", 500],
    [queryUrl("DELETE FROM items"), 500],
    [queryUrl("SELECT * FROM items; SELECT 1"), 500],
    [queryUrl("SELECT * FROM pg_catalog.pg_roles"), 500],
    [queryUrl("SELECT pg_sleep(1)"), 500],
    [queryUrl("SELECT * FROM missing_table"), 500],
    [queryUrl("SELECT 2"), 500]
  ];
  setExecute(async (sql) => {
    if (sql === "SELECT 2") return { rows: [1n] };
    throw new Error("initial query failed");
  });
  // Each failure case alone exceeds the actual 1000-subscription limit.
  for (const [url, status] of cases) {
    for (let i = 0; i < 1001; i++) {
      assert.equal((await app.request(url)).status, status, url);
    }
  }
  setExecute(async () => ({ rows: [{ id: 1 }] }));
  const response = await app.request(queryUrl("SELECT 3"));
  assert.equal(response.status, 200);
  await response.body.cancel();
});
test("live streams enforce the cap and release exactly once on abort and completion", async () => {
  const { app, setExecute, notify } = await fixture();
  const responses = [];
  try {
    for (let i = 0; i < 1e3; i++) {
      const response = await app.request(queryUrl("SELECT * FROM items"));
      assert.equal(response.status, 200);
      responses.push(response);
    }
    assert.equal((await app.request(queryUrl("SELECT 1"))).status, 503);
    await responses.pop().body.cancel();
    await turn();
    const replacement = await app.request(queryUrl("SELECT 1"));
    assert.equal(replacement.status, 200);
    responses.push(replacement);
    assert.equal((await app.request(queryUrl("SELECT 1"))).status, 503);
    setExecute(async () => {
      throw new Error("stream refresh failed");
    });
    notify();
    await turn();
    await turn();
    setExecute(async () => ({ rows: [] }));
    const next = await app.request(queryUrl("SELECT 4"));
    assert.equal(next.status, 200);
    await next.body.cancel();
  } finally {
    await Promise.all(responses.map((response) => response.body.cancel()));
    await turn();
  }
});
test("request aborts before and during SSE release slots without waiting for a block", async () => {
  const { app } = await fixture();
  for (let i = 0; i < 1001; i++) {
    const controller = new AbortController();
    if (i % 2 === 0) controller.abort();
    const response2 = await app.request(queryUrl("SELECT 1"), {
      signal: controller.signal
    });
    assert.equal(response2.status, 200);
    controller.abort();
    await response2.body.cancel();
  }
  await turn();
  const response = await app.request(queryUrl("SELECT 2"));
  assert.equal(response.status, 200);
  await response.body.cancel();
});

test("repeated live updates retain bounded memory until disconnect", async () => {
  const gc = global.gc;
  assert.ok(gc, "Run this suite with --expose-gc");
  const { app, notify } = await fixture();
  const responses = [];
  const collect = async () => {
    for (let i = 0; i < 5; i++) { await turn(); gc(); }
    return process.memoryUsage().heapUsed;
  };
  try {
    for (let i = 0; i < 50; i++) responses.push(await app.request(queryUrl("SELECT * FROM items")));
    for (let i = 0; i < 100; i++) { notify(); await turn(); }
    const before = await collect();
    for (let i = 0; i < 4000; i++) { notify(); await turn(); }
    const growth = (await collect()) - before;
    // The former lifetime abort promise retained about 60 MiB for this workload.
    // Leave ample room for JIT/GC variation while detecting retained reactions.
    assert.ok(growth < 16 * 1024 * 1024, `Live update heap grew by ${growth} bytes`);
  } finally {
    await Promise.all(responses.map(response => response.body.cancel()));
    await turn();
  }
});
