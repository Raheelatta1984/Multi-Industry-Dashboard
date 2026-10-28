/**
 * Database guard — the layer between the app and the database.
 *
 * Every read goes through {@link guardedQuery}, which answers from the
 * cheapest source that can give a *correct* answer:
 *
 *   1. **Positive cache** — the query result was cached (look-aside, see
 *      `memcached.ts`). Free.
 *   2. **Negative cache** — the query came back empty last time; the marker
 *      is still valid, so the answer is still "nothing here" and the database
 *      is not touched. See `negative.ts`.
 *   3. **Bloom filter** — the query is a point lookup (`where id = $1`) on a
 *      table whose primary keys are indexed; the filter says the key is
 *      definitely not there, so the database is not touched. See `bloom.ts`.
 *   4. **Database** — the only source of truth. The call is rate limited and
 *      concurrency limited so a burst cannot drain the connection pool.
 *
 * Correctness rules that make (2) and (3) safe:
 *
 * - A negative marker is only written for a query that returned **zero rows**,
 *   and it expires quickly (30s). A write to the table clears the markers for
 *   that table immediately.
 * - A Bloom filter only ever answers "maybe present" or "definitely absent"
 *   for keys it was built from. It is rebuilt from the table when it is
 *   invalidated (any write to that table) and it is only trusted to answer
 *   "definitely absent" when the caller can prove that no row was inserted
 *   after the snapshot — either because the key carries its own creation
 *   timestamp (the app's 64-bit `next_id` scheme) or because invalidations
 *   propagate through a shared cache.
 *
 * Identical concurrent queries are coalesced (single flight), so a burst of
 * the same expensive read costs one database round trip, not N.
 *
 * Env:
 *   NEGATIVE_CACHE_ENABLED / NEGATIVE_CACHE_TTL_SEC
 *   BLOOM_FILTER_ENABLED / BLOOM_FILTER_MAX_SCAN_ROWS / BLOOM_FILTER_TTL_SEC
 *   BLOOM_FILTER_TRUST_LOCAL  - trust a local (unshared) index (default: on
 *                               outside production, where one process serves
 *                               every request)
 *   DB_RATE_LIMIT_MAX / DB_RATE_LIMIT_WINDOW_SEC
 *   DB_MAX_CONCURRENT_QUERIES / DB_MAX_QUEUED_QUERIES
 */

import { BloomFilter, getBloomRegistry } from "./bloom.ts";
import { getNegativeCache } from "./negative.ts";
import { getCacheConfig, getMemcachedClient, buildCacheKey } from "./memcached.ts";
import {
  ConcurrencyLimiter,
  RateLimitError,
  TokenBucketRateLimiter,
  getDbRateLimitConfig,
} from "./rate-limit.ts";
import { singleFlight, getSingleFlightStats } from "./single-flight.ts";

export type QuerySource =
  | "positive-cache"
  | "negative-cache"
  | "bloom-filter"
  | "coalesced"
  | "database";

export interface GuardedQueryResult<T> {
  rows: T[];
  /** Where the answer came from — surfaced in the guard stats. */
  source: QuerySource;
}

export interface GuardStats {
  /** Read queries seen. */
  queries: number;
  /** Answered from the positive cache. */
  positiveCacheHits: number;
  /** Answered from a negative marker (no database round trip). */
  negativeCacheHits: number;
  /** Point lookups the Bloom filter cleared without a database round trip. */
  bloomHits: number;
  /** Queries that actually reached the database. */
  dbQueries: number;
  /** Database round trips avoided (negative cache + bloom filter). */
  dbQueriesSaved: number;
  /** Concurrent duplicates coalesced into one query. */
  coalesced: number;
  /** Queries rejected by the rate limiter. */
  rateLimited: number;
  /** Writes seen (each invalidates the affected tables). */
  writes: number;
}

export interface PointLookup {
  /** Table the lookup targets. */
  table: string;
  /** Column compared with `=`. */
  column: string;
  /** The value being looked up (stringified). */
  value: string;
  /** Zero-based index of the parameter in the parameter array. */
  paramIndex: number;
}

export interface InsertInfo {
  table: string;
  /** Column names in the order they appear in the VALUES tuple. */
  columns: string[];
  /** One array of values per VALUES tuple. */
  rows: unknown[][];
}

/** The runner used for the guard's own metadata queries. */
type MetaRunner = (text: string, params: unknown[]) => Promise<unknown[]>;

// ---------------------------------------------------------------------------
// Query analysis
// ---------------------------------------------------------------------------

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** `select <cols> from <table> where <col> = $n` — nothing else. */
const POINT_LOOKUP_RE =
  /^\s*select\s+([\s\S]+?)\s+from\s+([a-z_][a-z0-9_]*)\s+where\s+([a-z_][a-z0-9_]*)\s*=\s*\$(\d+)\s*;?\s*$/i;

/**
 * Analyse a query as a point lookup.
 *
 * Deliberately strict: anything with a join, an OR, a sub-query, a function
 * call, a limit or a second predicate returns `null` so the caller falls back
 * to a normal database round trip. A wrong "absent" answer is a correctness
 * bug; a missed optimisation is not.
 */
export function analyzePointLookup(sql: string, params: unknown[]): PointLookup | null {
  const match = POINT_LOOKUP_RE.exec(sql);
  if (!match) return null;
  const [, selectList, table, column, paramText] = match;
  if (!selectList || !table || !column || !paramText) return null;

  // A function call or a sub-query in the select list means the result is not
  // simply "the row with this key" (aggregates always return a row).
  if (/\(|\)|\bor\b|\bjoin\b|\blimit\b|\boffset\b|\bunion\b|\bexists\b/i.test(selectList)) {
    return null;
  }
  if (!IDENTIFIER.test(table) || !IDENTIFIER.test(column)) return null;

  const paramIndex = Number.parseInt(paramText, 10) - 1;
  if (!Number.isInteger(paramIndex) || paramIndex < 0 || paramIndex >= params.length) {
    return null;
  }
  const raw = params[paramIndex];
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "bigint") {
    return null;
  }
  return { table, column, value: String(raw), paramIndex };
}

const INSERT_RE =
  /^\s*insert\s+into\s+([a-z_][a-z0-9_]*)\s*\(([^)]+)\)\s*values\s*([\s\S]+?)\s*;?\s*$/i;

/**
 * Analyse an INSERT so the keys it creates can be pushed into the Bloom filter
 * of that table (keeping the filter a superset of the table contents).
 */
export function analyzeInsert(sql: string, params: unknown[]): InsertInfo | null {
  const match = INSERT_RE.exec(sql);
  if (!match) return null;
  const [, table, columnText, valuesText] = match;
  if (!table || !columnText || !valuesText) return null;
  if (!IDENTIFIER.test(table)) return null;

  const columns = columnText.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
  if (columns.some((c) => !IDENTIFIER.test(c))) return null;

  const rows: unknown[][] = [];
  let paramCursor = 0;
  for (const tuple of splitValueTuples(valuesText)) {
    const values: unknown[] = [];
    for (const cell of tuple) {
      const trimmed = cell.trim();
      const placeholder = /^\$(\d+)$/.exec(trimmed);
      if (placeholder) {
        const index = Number.parseInt(placeholder[1]!, 10) - 1;
        values.push(params[index]);
      } else if (/^null$/i.test(trimmed)) {
        values.push(null);
      } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        values.push(Number(trimmed));
      } else {
        // A literal expression we cannot map back to a key — the caller
        // invalidates the index instead.
        values.push(undefined);
      }
      paramCursor++;
    }
    rows.push(values);
  }
  void paramCursor;
  return { table, columns, rows };
}

/** Split `values (a, b), (c, d)` into tuples of raw cells. */
function splitValueTuples(text: string): string[][] {
  const tuples: string[][] = [];
  let depth = 0;
  let current: string[] = [];
  let cell = "";
  for (const char of text) {
    if (char === "(") {
      depth++;
      if (depth === 1) {
        current = [];
        cell = "";
        continue;
      }
    }
    if (char === ")") {
      depth--;
      if (depth === 0) {
        current.push(cell);
        tuples.push(current);
        current = [];
        cell = "";
        continue;
      }
    }
    if (char === "," && depth === 1) {
      current.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  return tuples;
}

/** Tables written by a statement (insert/update/delete). */
export function parseWriteTables(sql: string): string[] {
  const tables = new Set<string>();
  const insert = /^\s*insert\s+into\s+([a-z_][a-z0-9_]*)/i.exec(sql);
  if (insert?.[1]) tables.add(insert[1]);
  const update = /^\s*update\s+([a-z_][a-z0-9_]*)/i.exec(sql);
  if (update?.[1]) tables.add(update[1]);
  const deleteFrom = /^\s*delete\s+from\s+([a-z_][a-z0-9_]*)/i.exec(sql);
  if (deleteFrom?.[1]) tables.add(deleteFrom[1]);
  return [...tables];
}

/** The first table a statement touches (used as a cache namespace). */
export function primaryTable(sql: string): string | null {
  const from = /\bfrom\s+([a-z_][a-z0-9_]*)/i.exec(sql);
  if (from?.[1]) return from[1];
  const insert = /^\s*insert\s+into\s+([a-z_][a-z0-9_]*)/i.exec(sql);
  if (insert?.[1]) return insert[1];
  const update = /^\s*update\s+([a-z_][a-z0-9_]*)/i.exec(sql);
  if (update?.[1]) return update[1];
  return null;
}

/** Quote an identifier for interpolation — only simple identifiers are allowed. */
export function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Refusing to interpolate unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

// ---------------------------------------------------------------------------
// Guard state
// ---------------------------------------------------------------------------

interface GuardState {
  stats: GuardStats;
  limiter: TokenBucketRateLimiter;
  concurrency: ConcurrencyLimiter;
}

const globalRef = globalThis as typeof globalThis & {
  __dbGuardState__?: GuardState;
};

function guardState(): GuardState {
  if (!globalRef.__dbGuardState__) {
    const config = getDbRateLimitConfig();
    globalRef.__dbGuardState__ = {
      stats: {
        queries: 0,
        positiveCacheHits: 0,
        negativeCacheHits: 0,
        bloomHits: 0,
        dbQueries: 0,
        dbQueriesSaved: 0,
        coalesced: 0,
        rateLimited: 0,
        writes: 0,
      },
      limiter: new TokenBucketRateLimiter({
        limit: config.max,
        windowSec: config.windowSec,
        burst: config.max,
      }),
      concurrency: new ConcurrencyLimiter(config.maxConcurrent, config.maxQueue),
    };
  }
  return globalRef.__dbGuardState__;
}

export function getGuardStats(): GuardStats {
  return { ...guardState().stats };
}

export function resetGuardStats(): void {
  const state = guardState();
  state.stats = {
    queries: 0,
    positiveCacheHits: 0,
    negativeCacheHits: 0,
    bloomHits: 0,
    dbQueries: 0,
    dbQueriesSaved: 0,
    coalesced: 0,
    rateLimited: 0,
    writes: 0,
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function envFlag(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export interface GuardConfig {
  negativeCacheEnabled: boolean;
  negativeTtlSec: number;
  bloomEnabled: boolean;
  bloomMaxScanRows: number;
  bloomTtlSec: number;
  bloomTrustLocal: boolean;
  positiveTtlSec: number;
}

export function getGuardConfig(): GuardConfig {
  const production = process.env.NODE_ENV === "production";
  return {
    negativeCacheEnabled: envFlag("NEGATIVE_CACHE_ENABLED", true),
    negativeTtlSec: envInt("NEGATIVE_CACHE_TTL_SEC", 30),
    bloomEnabled: envFlag("BLOOM_FILTER_ENABLED", true),
    bloomMaxScanRows: envInt("BLOOM_FILTER_MAX_SCAN_ROWS", 50_000),
    bloomTtlSec: envInt("BLOOM_FILTER_TTL_SEC", 300),
    // Outside production the app runs as a single process, so a local index is
    // authoritative. In production a shared cache must carry the invalidations.
    bloomTrustLocal: envFlag("BLOOM_FILTER_TRUST_LOCAL", !production),
    positiveTtlSec: envInt("CACHE_DEFAULT_TTL_SEC", 60),
  };
}

// ---------------------------------------------------------------------------
// Bloom indexes
// ---------------------------------------------------------------------------

interface TableIndex {
  table: string;
  primaryKey: string;
  filter: BloomFilter;
  /** When the snapshot was taken (before the scan started). */
  builtAt: number;
}

const indexCache = new Map<string, TableIndex>();

/** Shared marker: the time of the most recent write to a table. */
function writeMarkerKey(table: string): string {
  return `bloomwrite:${table}`;
}

async function sharedCacheEnabled(): Promise<boolean> {
  const config = getCacheConfig();
  return config.enabled && config.servers.length > 0;
}

/**
 * Can a "definitely absent" answer from this index be trusted?
 *
 * Three ways to be sure, in order of strength:
 *   1. The key carries its own creation timestamp (the app's 64-bit `next_id`
 *      scheme) and that timestamp predates the snapshot — the row cannot have
 *      been created after the index was built, so the snapshot is authoritative
 *      for it. No coordination needed.
 *   2. The table has not been written since the snapshot, proven through the
 *      shared cache (every write records a marker other instances can read).
 *   3. The index is local and the deployment runs a single process
 *      (`BLOOM_FILTER_TRUST_LOCAL`), so the local index is authoritative.
 */
async function canTrustAbsence(
  index: TableIndex,
  key: string,
  trustLocal: boolean,
): Promise<boolean> {
  const timestamp = nextIdTimestamp(key);
  if (timestamp !== null && timestamp < index.builtAt) return true;

  if (!(await sharedCacheEnabled())) return trustLocal;

  try {
    const marker = await getMemcachedClient().get<number>(writeMarkerKey(index.table));
    // No marker -> no write has ever been recorded for this table.
    if (marker === null || marker === undefined) return true;
    if (marker <= index.builtAt) return true;
    // The table was written after the snapshot (possibly by another instance):
    // the snapshot is stale, so drop it and let the next lookup rebuild it.
    await invalidateBloomIndex(index.table);
    return false;
  } catch {
    // A cache outage: stay on the safe side and ask the database.
    return false;
  }
}

/**
 * The creation timestamp encoded in a 64-bit `next_id`, or `null` when the
 * value is not one (see `src/lib/id/next-id.ts` for the layout).
 */
export function nextIdTimestamp(value: string): number | null {
  if (!/^\d{1,19}$/.test(value)) return null;
  let big: bigint;
  try {
    big = BigInt(value);
  } catch {
    return null;
  }
  if (big <= 0n) return null;
  const epochMs = Number(big >> 23n);
  const timestampMs = epochMs + Date.UTC(2024, 0, 1);
  // Sanity: the scheme starts in 2024 — anything else is not one of our ids.
  if (!Number.isFinite(timestampMs) || timestampMs < Date.UTC(2024, 0, 1)) return null;
  if (timestampMs > Date.now() + 86_400_000) return null;
  return timestampMs;
}

/** Drop the index of a table (local only — the shared write marker covers the rest). */
export async function invalidateBloomIndex(table: string): Promise<void> {
  indexCache.delete(table);
  getBloomRegistry().invalidate(table);
}

/**
 * Resolve the primary key of a table (cached — the schema rarely changes).
 */
async function resolvePrimaryKey(table: string, meta: MetaRunner): Promise<string | null> {
  const rows = (await meta(
    `select kcu.column_name as "column"
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name
        and kcu.constraint_schema = tc.constraint_schema
        and kcu.table_name = tc.table_name
      where tc.constraint_type = 'PRIMARY KEY'
        and tc.table_name = $1
      order by kcu.ordinal_position
      limit 1`,
    [table],
  )) as Record<string, unknown>[];
  const column = rows[0]?.["column"];
  return typeof column === "string" ? column : null;
}

/**
 * Build (or fetch) the Bloom index of a table.
 *
 * The build is count-verified: when the table holds more rows than
 * `BLOOM_FILTER_MAX_SCAN_ROWS` the index is abandoned — a truncated scan would
 * produce false negatives, which is never acceptable.
 */
async function getTableIndex(table: string, meta: MetaRunner): Promise<TableIndex | null> {
  const config = getGuardConfig();
  if (!config.bloomEnabled) return null;

  const local = indexCache.get(table);
  if (local) return local;

  let primaryKey: string | null;
  try {
    primaryKey = await resolvePrimaryKey(table, meta);
  } catch {
    return null;
  }
  if (!primaryKey) return null;

  // The snapshot time is taken *before* the scan: a row committed while the
  // scan runs may or may not be in it, so the snapshot is only authoritative
  // for rows created before this moment.
  const builtAt = Date.now();

  // Declared without an initializer on purpose: the try either assigns it or the
  // catch returns, so a `= 0` default would be dead — and would silently mask a
  // failed count as a real zero.
  let count: number;
  try {
    const countRows = (await meta(
      `select count(*)::int as n from ${quoteIdentifier(table)}`,
      [],
    )) as Record<string, unknown>[];
    count = Number(countRows[0]?.n ?? 0);
  } catch {
    return null;
  }
  if (!Number.isFinite(count)) return null;
  if (count > config.bloomMaxScanRows) {
    // Too large to index safely — a truncated scan would produce false
    // negatives, which is never acceptable.
    return null;
  }

  let keys: Record<string, unknown>[];
  try {
    keys = (await meta(
      `select ${quoteIdentifier(primaryKey)} as k from ${quoteIdentifier(table)}`,
      [],
    )) as Record<string, unknown>[];
  } catch {
    return null;
  }

  const filter = new BloomFilter({
    expectedItems: Math.max(16, count),
    falsePositiveRate: 0.01,
  });
  for (const row of keys) {
    const value = row.k;
    if (value === null || value === undefined) continue;
    filter.add(String(value));
  }

  const index: TableIndex = { table, primaryKey, filter, builtAt };
  indexCache.set(table, index);
  getBloomRegistry().set(table, filter, index.builtAt);
  return index;
}

// ---------------------------------------------------------------------------
// The guarded query
// ---------------------------------------------------------------------------

export interface GuardedQueryOptions<T> {
  /** The SQL to run. */
  sql: string;
  /** Parameters for the SQL. */
  params?: unknown[];
  /** Runs the query against the database. */
  run: (text: string, params: unknown[]) => Promise<T[]>;
  /**
   * Runs the guard's own metadata queries (primary key lookup, row count, key
   * scan). MUST bypass the guard — a metadata query that re-enters the guard
   * would recurse forever. Defaults to `run`.
   */
  meta?: (text: string, params: unknown[]) => Promise<unknown[]>;
  /** Positive cache TTL in seconds. */
  ttlSec?: number;
  /** Skip the caches entirely (writes, or queries that must be fresh). */
  bypassCache?: boolean;
}

export async function guardedQuery<T = Record<string, unknown>>(
  options: GuardedQueryOptions<T>,
): Promise<GuardedQueryResult<T>> {
  const state = guardState();
  const config = getGuardConfig();
  const params = options.params ?? [];
  const sql = options.sql;
  state.stats.queries++;

  const table = primaryTable(sql);
  const namespace = table ?? "sql";
  // The cache key is namespaced by table so a write can invalidate every
  // cached result of that table exactly (`sql:<table>:*`).
  const cacheKey = buildCacheKey(table ? `sql:${table}` : "sql", { q: sql, p: params });
  const negativeKey = cacheKey;

  // --- 1. positive cache -------------------------------------------------
  if (!options.bypassCache && getCacheConfig().enabled) {
    try {
      const cached = await getMemcachedClient().get<T[]>(cacheKey);
      if (cached !== null) {
        state.stats.positiveCacheHits++;
        return { rows: cached, source: "positive-cache" };
      }
    } catch {
      // A cache outage must not break the read.
    }
  }

  // --- 2. negative cache -------------------------------------------------
  if (!options.bypassCache && config.negativeCacheEnabled) {
    const negative = getNegativeCache();
    if (await negative.has(namespace, negativeKey)) {
      state.stats.negativeCacheHits++;
      state.stats.dbQueriesSaved++;
      return { rows: [], source: "negative-cache" };
    }
  }

  // --- 3. bloom filter ---------------------------------------------------
  let lookup: PointLookup | null = null;
  if (!options.bypassCache && config.bloomEnabled && table) {
    lookup = analyzePointLookup(sql, params);
    if (lookup) {
      const meta = options.meta ?? (options.run as unknown as MetaRunner);
      const index = await getTableIndex(table, meta);
      if (index && index.primaryKey === lookup.column) {
        const trusted = await canTrustAbsence(index, lookup.value, config.bloomTrustLocal);
        if (trusted && !index.filter.has(lookup.value)) {
          // Definitely absent — no database round trip.
          state.stats.bloomHits++;
          state.stats.dbQueriesSaved++;
          if (config.negativeCacheEnabled) {
            await getNegativeCache().mark(namespace, negativeKey, config.negativeTtlSec);
          }
          return { rows: [], source: "bloom-filter" };
        }
      }
    }
  }

  // --- 4. the database ---------------------------------------------------
  const rows = await runGuarded(options.run, sql, params);

  if (!options.bypassCache && getCacheConfig().enabled && rows.length > 0) {
    try {
      await getMemcachedClient().set(cacheKey, rows, options.ttlSec ?? config.positiveTtlSec);
    } catch {
      // Ignore.
    }
  }

  if (!options.bypassCache && config.negativeCacheEnabled && rows.length === 0) {
    await getNegativeCache().mark(namespace, negativeKey, config.negativeTtlSec);
  }

  // Keep the Bloom index fresh with the key we just found.
  if (lookup && rows.length > 0 && table) {
    const index = indexCache.get(table);
    const keyColumn = (rows[0] as Record<string, unknown> | undefined)?.[lookup.column];
    if (index && keyColumn !== undefined && keyColumn !== null) {
      index.filter.add(String(keyColumn));
    }
  }

  return { rows, source: "database" };
}

/**
 * Run the query under the rate limit and the concurrency limit, and coalesce
 * identical concurrent queries into a single database round trip.
 */
async function runGuarded<T>(
  run: (text: string, params: unknown[]) => Promise<T[]>,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const state = guardState();
  const config = getDbRateLimitConfig();

  if (config.enabled) {
    const decision = state.limiter.consume("db");
    if (!decision.allowed) {
      state.stats.rateLimited++;
      throw new RateLimitError(
        "Database rate limit exceeded — retry shortly.",
        decision.retryAfterSec,
        decision.limit,
      );
    }
  }

  const execute = async (): Promise<T[]> => {
    // The counter is here (not in the caller) so it counts *round trips*:
    // N coalesced callers are one round trip, not N.
    state.stats.dbQueries++;
    if (!config.enabled) return run(sql, params);
    return state.concurrency.run(() => run(sql, params));
  };

  // Coalesce identical concurrent reads: one database round trip for N
  // identical requests.
  const key = buildCacheKey("flight", { q: sql, p: params });
  const coalescedBefore = getSingleFlightStats().coalesced;
  const rows = await singleFlight(key, execute);
  state.stats.coalesced += getSingleFlightStats().coalesced - coalescedBefore;
  return rows;
}

/**
 * Drop the cached rows and the negative markers of a table, and record the
 * write so other instances know their Bloom snapshot is stale.
 *
 * The Bloom index itself is kept — it stays a superset of the table unless a
 * primary key changed (see `noteWrite`).
 */
async function invalidateTableCaches(table: string): Promise<void> {
  // The shared write marker lets other instances notice that their snapshot
  // no longer covers the table.
  try {
    if (getCacheConfig().enabled) {
      await getMemcachedClient().set(writeMarkerKey(table), Date.now(), 3600);
    }
  } catch {
    // Ignore — a cache outage must not break a write.
  }

  if (getGuardConfig().negativeCacheEnabled) {
    await getNegativeCache().removeNamespace(table);
  }
  try {
    if (getCacheConfig().enabled) {
      await getMemcachedClient().invalidatePattern(`sql:${table}:*`);
    }
  } catch {
    // Ignore.
  }
}

/**
 * Drop everything the guard knows about a table: the cached rows, the negative
 * markers and the Bloom index.
 *
 * Called automatically for every write that goes through `getSql()`. Call it
 * explicitly when a table is written **outside** that path (a library with its
 * own connection pool, a migration script, a maintenance job) — otherwise the
 * guard keeps serving the old answer until the cache expires.
 */
export async function invalidateTable(table: string): Promise<void> {
  await invalidateTableCaches(table);
  await invalidateBloomIndex(table);
}

/**
 * Notify the guard that a write happened: the Bloom index and the negative
 * markers of the affected tables are dropped, and the shared cache records the
 * write so other instances know their snapshot is stale.
 */
export async function noteWrite(sql: string, params: unknown[] = []): Promise<void> {
  const state = guardState();
  state.stats.writes++;
  const tables = parseWriteTables(sql);
  if (tables.length === 0) return;

  const insert = analyzeInsert(sql, params);
  const isInsert = insert !== null;
  const isUpdate = /^\s*update\s/i.test(sql);

  for (const table of tables) {
    await invalidateTableCaches(table);

    const index = indexCache.get(table);
    if (!index) continue;

    if (isInsert && insert) {
      // An INSERT only adds keys: the snapshot stays a superset when the new
      // keys can be read from the statement, so the index survives.
      const columnIndex = insert.columns.indexOf(index.primaryKey);
      const values: string[] = [];
      if (columnIndex >= 0) {
        for (const row of insert.rows) {
          const value = row[columnIndex];
          if (value === undefined || value === null) continue;
          values.push(String(value));
        }
      }
      if (values.length > 0 && values.length === insert.rows.length) {
        for (const value of values) index.filter.add(value);
        continue;
      }
      await invalidateBloomIndex(table);
      continue;
    }

    if (isUpdate && updateTouchesPrimaryKey(sql, index.primaryKey)) {
      // The primary key itself changed: the new value is not in the snapshot.
      await invalidateBloomIndex(table);
      continue;
    }

    // A DELETE (or an UPDATE that leaves the key alone) keeps the filter a
    // superset — deleted keys stay in it and only cost a database lookup.
  }
}

/** Does an UPDATE assign the primary key column? */
function updateTouchesPrimaryKey(sql: string, primaryKey: string): boolean {
  const setMatch = /\bset\b([\s\S]*?)\bwhere\b/i.exec(sql);
  if (!setMatch?.[1]) return false;
  const assignments = setMatch[1];
  return new RegExp(`(^|[,\\s])${primaryKey}\\s*=`, "i").test(assignments);
}
