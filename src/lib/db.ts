import { pendingMigrations } from "../../scripts/migration-plan.mjs";
import { isReadOnlyQuery } from "./db/replicas";

/** Which database backend is active. */
export type DbSource = "neon" | "pglite";

// An empty/whitespace DATABASE_URL (an easy misconfig in deploy UIs) must mean
// "unset" — otherwise production would silently run on the PGLite fallback.
const rawDatabaseUrl =
  typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;
const databaseUrl =
  rawDatabaseUrl && rawDatabaseUrl.trim() ? rawDatabaseUrl : undefined;

/**
 * Active backend: real **Neon** when `DATABASE_URL` is set (deployed / configured
 * sandbox), otherwise a local embedded **PGLite** (Postgres compiled to WASM) so
 * the app has a working database even with nothing configured — the live preview
 * included. Swap in Neon later by just setting `DATABASE_URL`; no code changes.
 */
export const dbSource: DbSource = databaseUrl ? "neon" : "pglite";

/**
 * Minimal shared SQL surface, satisfied by both Neon and PGLite. Both the
 * tagged-template and `.query()` forms resolve to an array of row objects:
 *
 *   const sql = await getSql();
 *   const rows = await sql`select * from todos where id = ${id}`; // parameterized
 *   const rows2 = await sql.query("select * from todos where id = $1", [id]);
 */
export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

/**
 * Init state lives on globalThis as promises: dev HMR creates new instances of
 * this module, and two instances racing module-level state would open a second
 * pool or run two concurrent PGLite migration passes (whose duplicate
 * `_migrations` insert rejects — and would get memoized, poisoning every later
 * `getSql()`). A failed init clears its slot so the next call retries.
 */
const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
};

/**
 * Result-type parity: Postgres sends every value as text plus a type OID — the
 * JS value is the DRIVER's parsing choice, and pg and PGLite disagree (pg:
 * int8 -> string, date -> local-midnight Date; PGLite: int8 -> BigInt, which
 * JSON.stringify rejects, date -> UTC Date). Normalize both so preview and
 * production return identical, JSON-safe shapes:
 *   int8/bigint (incl. count(*)) -> number (past 2^53 loses precision — cast
 *                                   `::text` if you ever need huge integers)
 *   date                         -> 'YYYY-MM-DD' string
 *   interval                     -> Postgres interval text
 * numeric already comes back as a string on both (arbitrary precision).
 */
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

/** Wrap a query runner in the tagged-template + `.query()` `Sql` surface. */
function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    // Rebuild with $1, $2, … placeholders so values stay parameterized.
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

// ---------------------------------------------------------------------------
// Neon + PgBouncer + Read Replicas + Memcached integration
// ---------------------------------------------------------------------------

async function createNeonSql(): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);

    // Lazy imports to avoid circular deps - these modules are server-only
    const { getPgbouncerConfig, getPgbouncerPool } = await import("./db/pgbouncer");
    const { getReplicaConfig, getReplicaPool } = await import("./db/replicas");

    const pgbouncerCfg = getPgbouncerConfig();
    const replicaCfg = getReplicaConfig();

    let primaryPool: import("pg").Pool | null = null;

    // Try PgBouncer pool first if enabled
    if (pgbouncerCfg.enabled) {
      try {
        const pgbPool = await getPgbouncerPool();
        if (pgbPool) {
          primaryPool = pgbPool;
          console.log(`[db] Using PgBouncer pool (mode=${pgbouncerCfg.poolMode}, max=${pgbouncerCfg.maxPoolSize})`);
        }
      } catch (e) {
        console.warn("[db] PgBouncer pool init failed, falling back to direct pool:", e);
      }
    }

    // Fallback to direct primary pool
    if (!primaryPool) {
      primaryPool = new Pool({ connectionString: databaseUrl });
      if (pgbouncerCfg.enabled) {
        console.log("[db] PgBouncer enabled but pool not available, using direct Neon pool");
      }
    }

    return toSql(async <T>(text: string, params: unknown[]) => {
      const readOnly = isReadOnlyQuery(text);
      const useReplica = replicaCfg.routingEnabled && readOnly && replicaCfg.replicaUrls.length > 0;

      // The unguarded runners. The guard's own metadata queries (primary key
      // lookup, row count, key scan) MUST NOT re-enter the guard — that would
      // recurse forever — so they go straight to the primary.
      const meta = async (queryText: string, queryParams: unknown[]): Promise<T[]> => {
        const res = await primaryPool!.query(queryText, queryParams);
        return res.rows as T[];
      };

      // --- Reads: negative cache, Bloom filter and rate limiting live in the
      // guard, so a miss that can be answered from a cache never reaches the
      // database at all. ---
      if (readOnly) {
        const { guardedQuery } = await import("./cache/db-guard");
        const result = await guardedQuery<T>({
          sql: text,
          params,
          meta,
          run: async (queryText, queryParams) => {
            // Replica routing for reads
            if (useReplica) {
              try {
                const replicaPool = await getReplicaPool();
                if (replicaPool) {
                  const res = await replicaPool.query(queryText, queryParams);
                  return res.rows as T[];
                }
              } catch (err) {
                console.warn("[db] replica query failed, falling back to primary:", err);
              }
            }
            // Primary query (fallback)
            const res = await primaryPool!.query(queryText, queryParams);
            return res.rows as T[];
          },
        });
        return result.rows;
      }

      // --- Writes: primary only, then invalidate what the write touched ---
      const res = await primaryPool!.query(text, params);
      const rows = res.rows as T[];

      const { noteWrite } = await import("./cache/db-guard");
      await noteWrite(text, params);

      return rows;
    });
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}

async function createPgliteSql(): Promise<Sql> {
  // Embedded Postgres, imported on demand so it never loads on the Neon path.
  // One in-memory instance per process, shared across HMR module instances, so
  // data survives source edits (it resets on dev-server restart).
  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite({
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
    });
    await pg.waitReady;
    await pg.exec(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    return pg;
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  // Apply migrations/ (the single schema source) so preview matches production.
  // SQL is inlined by the bundler via import.meta.glob (no runtime fs); applied
  // files are tracked in _migrations. The glob does not descend, so the opt-in
  // auth schema under migrations/auth/ stays out. Runs once per module instance
  // — so an HMR reload after adding a migration file applies it live — with
  // passes serialized on a global chain so concurrent callers never
  // double-apply.
  const migrate = async (): Promise<void> => {
    const migrations = import.meta.glob("/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const doneRows = await pg.query<{ name: string }>(
      "select name from _migrations",
    );
    const done = doneRows.rows.map((r) => r.name);
    for (const { name, path } of pendingMigrations(Object.keys(migrations), done)) {
      // Apply + record atomically (parity with scripts/migrate.mjs) so a failed
      // statement can't leave a file half-applied but untracked.
      await pg.transaction(async (tx) => {
        await tx.exec(migrations[path]);
        await tx.query("insert into _migrations (name) values ($1)", [name]);
      });
    }
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined) // an earlier failed pass must not wedge the chain
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return toSql(async <T>(text: string, params: unknown[]) => {
    const readOnly = isReadOnlyQuery(text);

    // The unguarded runner. The guard's own metadata queries (primary key
    // lookup, row count, key scan) MUST NOT re-enter the guard — that would
    // recurse forever.
    const raw = async (queryText: string, queryParams: unknown[]): Promise<T[]> => {
      const queryResult = await pg.query<T>(queryText, queryParams);
      return queryResult.rows;
    };

    // Reads go through the guard: the positive cache, the negative cache and
    // the Bloom filter answer most of them without touching the database at
    // all, and the remaining ones are rate limited.
    if (readOnly) {
      const { guardedQuery } = await import("./cache/db-guard");
      const result = await guardedQuery<T>({
        sql: text,
        params,
        run: raw,
        meta: raw,
      });
      return result.rows;
    }

    const result = await pg.query<T>(text, params);
    const { noteWrite } = await import("./cache/db-guard");
    await noteWrite(text, params);
    return result.rows;
  });
}

let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  return dbSource === "neon" ? createNeonSql() : createPgliteSql();
}

/**
 * Get the shared, **server-only** SQL client. Neon when `DATABASE_URL` is set,
 * otherwise the local PGLite fallback. Memoized — safe to call per request.
 *
 * Enhanced with:
 *   - PgBouncer pooling (if PGBOUNCER_ENABLED or PGBOUNCER_URL set)
 *   - Read replica routing (if DATABASE_REPLICA_URLS set)
 *   - The request guard for reads: positive cache, negative cache, Bloom
 *     filter, rate limiting and request coalescing (see `cache/db-guard.ts`)
 *
 * Schema comes from `migrations/*.sql`, auto-applied before the first query on
 * both backends — define tables there, never inline in server functions.
 */
export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch((err) => {
    sqlPromise = null; // don't memoize failures — let the next call retry
    throw err;
  });
  return sqlPromise;
}

let rawSqlPromise: Promise<Sql> | null = null;

/**
 * The **unguarded** SQL client — every query hits the database.
 *
 * The guard needs it for its own metadata queries (primary key lookup, row
 * count, key scan): those must never re-enter the guard, or the guard would
 * call itself forever. Also the escape hatch for maintenance queries that must
 * see the real state of the database.
 */
export function getRawSql(): Promise<Sql> {
  rawSqlPromise ??= (async () => {
    if (dbSource === "neon") {
      const { getPrimaryPool } = await import("./db/replicas");
      const pool = await getPrimaryPool();
      if (!pool) throw new Error("No primary pool available for the raw SQL client");
      return toSql(async <T>(text: string, params: unknown[]) => {
        const res = await pool.query(text, params);
        return res.rows as T[];
      });
    }
    await getSql(); // bootstraps PGLite and applies the migrations
    const pg = await globalRef.__pgliteInstance__;
    if (!pg) throw new Error("PGLite instance failed to initialize");
    return toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    });
  })().catch((err) => {
    rawSqlPromise = null;
    throw err;
  });
  return rawSqlPromise;
}

/**
 * The shared PGLite instance (preview only), with `migrations/*.sql` applied.
 * Lets Better Auth persist to the SAME embedded DB as app data in preview (via a
 * Kysely dialect). Throws when `DATABASE_URL` is set (that path uses Neon).
 */
export async function getPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  if (dbSource !== "pglite") {
    throw new Error("getPglite() is only available on the PGLite fallback (no DATABASE_URL)");
  }
  await getSql();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  return pg;
}

/**
 * Finish DB bootstrap before the server handles traffic.
 *
 * - **PGLite** (preview / no `DATABASE_URL`): open the in-memory DB and apply
 *   `migrations/*.sql`. Idempotent — concurrent callers share one promise.
 * - **Neon**: no-op (pool is created lazily on first query).
 *
 * Vite `configureServer` awaits this at dev startup; production imports of this
 * module kick it off immediately (see bottom of file).
 */
export function ensureDbReady(): Promise<void> {
  if (dbSource !== "pglite") return Promise.resolve();
  return getSql().then(() => undefined);
}

// Server-only eager start: kick PGLite bootstrap as soon as this module loads in
// Node. Client bundles never hit this path (`getSql` throws in the browser).
const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};
if (typeof window === "undefined" && dbSource === "pglite") {
  globalBoot.__pgBootstrapPromise__ ??= ensureDbReady().catch((err) => {
    globalBoot.__pgBootstrapPromise__ = undefined;
    console.error("[db] PGLite bootstrap failed:", err);
    throw err;
  });
}

// Re-export enhanced modules for convenience
export { getPgbouncerConfig, getPgbouncerPool, getPgbouncerPoolOptions } from "./db/pgbouncer";
export { getReplicaConfig, isReadOnlyQuery, queryWithRouting, getPrimaryPool, getReplicaPool } from "./db/replicas";
export { getCacheConfig, getMemcachedClient, dashboardCache, queryCache, cachedQuery, invalidateCache } from "./cache/memcached";
export { nextId, nextIdBigInt, parseId, sortIds, getShardFromId } from "./id/next-id";
export { getShardForImage, getMachineForShard, resolveImageLocation, getMachineMap, getShardDistribution } from "./storage/image-sharding";
