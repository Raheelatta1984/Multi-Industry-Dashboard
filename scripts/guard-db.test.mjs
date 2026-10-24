/**
 * The database guard, exercised against the real database layer.
 *
 * The TypeScript modules are loaded through Vite's SSR loader (the same way
 * `ingest-onboarding.test.mjs` drives the ingest store), so this runs under
 * `node --test` without a browser and without a database server — the PGLite
 * fallback is a real Postgres compiled to WASM.
 *
 * What it proves:
 *   - a missing key is answered from the Bloom filter / negative cache
 *     instead of the database,
 *   - a row that appears later is visible immediately (the markers and the
 *     Bloom index are invalidated by the write),
 *   - a write invalidates the cached results of the table it touched.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));

let server;
let sql;
let guardedSql;
let guard;
let stats;

before(async () => {
  const { createServer } = await import(require.resolve("vite"));
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { "@": join(ROOT, "src") } },
  });
  const load = (p) => server.ssrLoadModule(p);
  const db = await load("/src/lib/db.ts");
  guard = await load("/src/lib/cache/db-guard.ts");
  // The raw client bypasses the guard — the test drives the guard itself.
  sql = await db.getRawSql();
  // Writes go through the guarded client, exactly like the app does, so the
  // invalidation the guard performs on a write is exercised too.
  guardedSql = await db.getSql();
  stats = guard.getGuardStats;

  await sql.query(
    "create table if not exists guard_demo (id text primary key, label text not null)",
  );
});

after(async () => {
  await server?.close();
});

/** Run a query through the guard (the path the app uses). */
async function guarded(text, params = []) {
  const result = await guard.guardedQuery({
    sql: text,
    params,
    run: (queryText, queryParams) => sql.query(queryText, queryParams),
    meta: (queryText, queryParams) => sql.query(queryText, queryParams),
  });
  return result;
}

test("a missing key is answered without a second database round trip", async () => {
  const before = stats().dbQueries;

  const first = await guarded("select * from guard_demo where id = $1", ["missing-row"]);
  assert.equal(first.rows.length, 0);
  assert.ok(["database", "bloom-filter"].includes(first.source));

  const second = await guarded("select * from guard_demo where id = $1", ["missing-row"]);
  assert.equal(second.rows.length, 0);
  assert.equal(second.source, "negative-cache");

  const after = stats().dbQueries;
  assert.ok(after - before <= 1, `expected at most one database query, saw ${after - before}`);
});

test("a row that appears later is visible immediately", async () => {
  // The lookup is cached as "missing" ...
  await guarded("select * from guard_demo where id = $1", ["late-row"]);

  // ... then the row is inserted (through the guarded client, like the app).
  await guardedSql.query("insert into guard_demo (id, label) values ($1, $2)", [
    "late-row",
    "hello",
  ]);

  const found = await guarded("select * from guard_demo where id = $1", ["late-row"]);
  assert.equal(found.rows.length, 1, "the write must invalidate the missing-row marker");
  assert.equal(found.rows[0].label, "hello");
});

test("a write invalidates the cached rows of the table it touched", async () => {
  await guardedSql.query("insert into guard_demo (id, label) values ($1, $2)", [
    "row-a",
    "first",
  ]);
  const first = await guarded("select * from guard_demo where id = $1", ["row-a"]);
  assert.equal(first.rows[0].label, "first");

  await guardedSql.query("update guard_demo set label = $1 where id = $2", ["second", "row-a"]);
  const second = await guarded("select * from guard_demo where id = $1", ["row-a"]);
  assert.equal(second.rows[0].label, "second", "the cached row must be dropped by the write");
});

test("identical concurrent reads cost one database round trip", async () => {
  await guardedSql.query("insert into guard_demo (id, label) values ($1, $2)", ["row-b", "x"]);

  // Warm the Bloom index of the table so the three reads below reach the
  // database at the same time (the first read would otherwise build it).
  await guarded("select * from guard_demo where id = $1", ["warmup"]);

  const before = stats().dbQueries;
  // A slow query makes the overlap deterministic.
  const slow = (queryText, queryParams) =>
    new Promise((resolve) => {
      setTimeout(() => resolve(sql.query(queryText, queryParams)), 60);
    });
  const read = () =>
    guard.guardedQuery({
      sql: "select * from guard_demo where id = $1",
      params: ["row-b"],
      run: slow,
      meta: (queryText, queryParams) => sql.query(queryText, queryParams),
    });

  const results = await Promise.all([read(), read(), read()]);
  assert.equal(results[0].rows.length, 1);
  assert.equal(results[1].rows.length, 1);
  assert.equal(results[2].rows.length, 1);
  const spent = stats().dbQueries - before;
  assert.ok(spent <= 1, `expected the reads to be coalesced, saw ${spent} database queries`);
});
