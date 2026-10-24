# Scalability Architecture

This document describes the scalability improvements implemented to handle high traffic, avoid ID clashes, and scale image storage.

1. [PgBouncer for Neon Postgres](#1-pgbouncer-for-neon-postgres)
2. [Read Replicas + Memcached](#2-read-replicas--memcached)
3. [Request Guard — rate limiting, negative cache, Bloom filter](#3-request-guard--rate-limiting-negative-cache-bloom-filter)
4. [Logical Shards + Machine Map for Images](#4-logical-shards--machine-map-for-images)
5. [Distributed 64-bit IDs (next_id)](#5-distributed-64-bit-ids-next_id)

## 1. PgBouncer for Neon Postgres

**File:** `src/lib/db/pgbouncer.ts`

Neon provides a pooled endpoint, but for thousands of concurrent serverless functions we add PgBouncer transaction pooling.

- **Pool mode:** `transaction` (default) - multiplexes many client connections to few Postgres connections
- **Config via env:**
  - `DATABASE_URL` - primary Neon URL
  - `PGBOUNCER_URL` - optional dedicated PgBouncer URL (if you run PgBouncer externally)
  - `PGBOUNCER_ENABLED=true` - force PgBouncer-friendly pool even without separate URL
  - `PGBOUNCER_POOL_MODE=transaction|session|statement`
  - `PGBOUNCER_MAX_CLIENT_CONN`, `PGBOUNCER_DEFAULT_POOL_SIZE`, `PGBOUNCER_MAX_POOL_SIZE`, etc.
- **Implementation:** `getPgbouncerPool()` returns a singleton `pg.Pool` configured for PgBouncer (statement_timeout, application_name, keepalive). Falls back to direct pool if PgBouncer not reachable.
- **Example pgbouncer.ini:** generated via `generatePgbouncerIni()`

**Why it matters:** Prevents connection storms when Vercel scales to hundreds of instances. Each instance uses few actual PG connections.

## 2. Read Replicas + Memcached

### Read Replicas
**File:** `src/lib/db/replicas.ts`

- **Env:** `DATABASE_REPLICA_URLS` or `READ_REPLICA_URLS` (comma-separated), or single `DATABASE_REPLICA_URL`
- **Routing:** `isReadOnlyQuery()` classifies SELECT/SHOW/EXPLAIN/WITH as read-only -> replica, others -> primary
- **Selection:** Round-robin with fallback to primary
- **Forced primary:** Prefix query with `-- primary` or `/* primary */`
- **Health check:** `getHealthyReplicas()`

### Memcached
**File:** `src/lib/cache/memcached.ts`

- **Problem:** Too many reads hitting DB even with replicas
- **Solution:** Look-aside cache for hot queries (150+ boards, FX rates, revenue)
- **Env:** `MEMCACHED_SERVERS` (comma-separated host:port), `MEMCACHED_URL`, `MEMCACHED_ENABLED`, `MEMCACHED_DEFAULT_TTL`
- **Fallback:** In-memory LRU when no external Memcached configured (works in preview/dev)
- **API:**
  - `getMemcachedClient()` - singleton client
  - `getOrSet(key, fn, ttl)` - cache-aside
  - `cachedQuery(key, fn, ttl)` - cached query wrapper
  - `dashboardCache` - board-specific helpers with 2-min TTL
  - `invalidateCache(pattern)` - glob invalidation
- **Integration in `src/lib/db.ts`:** Read queries check Memcached first, then replica, then primary, and populate cache. Writes invalidate relevant patterns.

**Data flow:**
```
App -> Memcached (hit? return) -> Replica (round-robin) -> Primary (fallback) -> populate cache
Write -> Primary (PgBouncer) -> invalidate cache
```

## 3. Request Guard — rate limiting, negative cache, Bloom filter

**Files:** `src/lib/cache/request-guard.server.ts` (HTTP edge), `src/lib/cache/db-guard.ts`
(database edge), `src/lib/cache/{bloom,negative,rate-limit,single-flight}.ts` (the parts),
`src/start.ts` (where the middleware is registered).

The rule behind all of it: **never let a request that cannot succeed reach the
database.** A lookup for a row that does not exist, a client looping over
guessed ids, a burst of identical reads — each of them is work the server does
for nothing, and each of them is a way to take the database down.

### 3.1 Rate limiting (HTTP)

`requestGuardMiddleware` is registered in `src/start.ts` next to the CSRF
middleware, so it covers page loads, API calls and server functions alike.

- A **token bucket per client** (the first `x-forwarded-for` address, falling
  back to `x-real-ip` / `cf-connecting-ip` / `x-vercel-forwarded-for`).
- Three budgets: page/API requests, static assets (cheap but numerous) and
  `/api/auth/*` (small — sign-in is the endpoint worth protecting).
- Over budget → `429` with `Retry-After` and the `X-RateLimit-*` headers. The
  request never reaches the router or the database.
- A refused request does **not** spend tokens, so a client hammering a closed
  door does not push its own recovery further into the future.

### 3.2 Negative caching

A query that comes back **empty** is remembered, so the repeat of it costs
nothing:

- `src/lib/cache/negative.ts` — a bounded TTL map (local) mirrored into the
  shared cache, so a fleet shares the markers instead of each hitting the
  database once.
- The TTL is short (`NEGATIVE_CACHE_TTL_SEC`, 30s) compared with the positive
  cache (60s): a row that appears later shows up quickly, but a burst of
  identical misses still collapses into one query.
- A **write invalidates the markers of the table it touched** — the row is
  visible on the very next read.
- At the HTTP layer the same idea covers `404`s: a `GET` that came back `404`
  is remembered for 15 seconds and the next identical request is answered
  directly (`x-cache: negative`) without running the router.

### 3.3 Bloom filter

For **point lookups** (`select … from t where id = $1`) the guard keeps a
Bloom filter of the primary keys of the table:

- "Maybe present" → ask the database (a false positive only costs one query).
- "Definitely absent" → answer empty **without touching the database**.
- The index is built from a full, count-verified scan of the table. A table
  larger than `BLOOM_FILTER_MAX_SCAN_ROWS` is not indexed at all — a truncated
  scan would produce false negatives, which is never acceptable.
- A Bloom filter cannot be trusted blindly, so the guard only believes it when
  it can prove no row was inserted after the snapshot:
  1. the key carries its own creation timestamp (the app's 64-bit `next_id`
     scheme) and that timestamp predates the snapshot — no coordination needed;
  2. or the table has not been written since the snapshot, proven through the
     shared cache (every write records a marker other instances can read);
  3. or the deployment runs a single process (`BLOOM_FILTER_TRUST_LOCAL`).
- Any write to the table invalidates the index (an `INSERT` whose keys can be
  read only refreshes it), so the snapshot stays a superset of the table.

### 3.4 Rate limiting + concurrency limiting (database)

- A token bucket over the queries of the process (`DB_RATE_LIMIT_MAX` per
  `DB_RATE_LIMIT_WINDOW_SEC`) — over budget the query fails fast with a
  `RateLimitError` instead of piling up.
- A **concurrency limiter** (`DB_MAX_CONCURRENT_QUERIES`) caps how many
  queries run at once. Rate limiting alone does not stop a burst of 50
  requests that each take two seconds; the concurrency cap does, and it keeps
  the connection pool from being drained.
- **Request coalescing** (`single-flight.ts`): identical concurrent reads are
  merged into one database round trip.

### 3.5 Where it sits in the read path

```
Read
 ├─ positive cache hit?            -> return rows                    (no DB)
 ├─ negative marker?               -> return []                      (no DB)
 ├─ point lookup + Bloom filter?   -> return []                      (no DB)
 └─ database                       -> rate limited, concurrency
                                      limited, coalesced with
                                      identical concurrent reads
                                      -> populate the caches
```

`src/lib/db.ts` routes **both** backends (Neon and the PGLite preview
fallback) through the guard, so the preview behaves like production.
`getRawSql()` is the escape hatch: the unguarded client the guard uses for its
own metadata queries (a metadata query that re-entered the guard would recurse
forever) and for maintenance work.

> **Writes outside `getSql()`** (for example a library with its own connection
> pool) do not invalidate the caches automatically. Either route them through
> `getSql()` or call `invalidateTable()` after them.

### 3.6 Live panel

`/scalability` shows the counters of both guards and has a **probe** button:
it looks up a key that does not exist three times and shows which layer
answered each time — `bloom-filter → negative-cache → negative-cache`, with
zero database round trips.

## 4. Logical Shards + Machine Map for Images

**File:** `src/lib/storage/image-sharding.ts`

- **Logical shards:** Fixed 1024 virtual shards (configurable via `IMAGE_LOGICAL_SHARDS`) - never changes
- **Physical machines:** Actual storage nodes (S3 buckets, disks) - e.g. 8 machines, configurable via `IMAGE_PHYSICAL_MACHINES` (count or comma-separated IDs)
- **Machine map:** `shardToMachine` mapping logical -> physical, versioned via `IMAGE_SHARD_MAP_VERSION`
- **Hashing:** FNV-1a 32-bit hash for uniform distribution
- **Path:** `meridian/images/{machineId}/shard-{shard}/{first2chars}/{imageId}.{ext}`
- **Rebalancing:** Adding a machine only moves subset of shards (consistent hashing). `simulateAddMachine()` shows impact.
- **APIs:**
  - `getShardForImage(imageId)`
  - `getMachineForShard(shard)`
  - `getMachineForImage(imageId)`
  - `resolveImagePath(imageId, ext)`
  - `resolveImageLocation(imageId, ext)` -> full location with URL
  - `getShardDistribution()`
  - `getMachineMap()`

**Benefits:**
- No hot shards (logical >> physical)
- Scale by adding machines + bumping map version
- Machine map can be rolled out gradually

## 5. Distributed 64-bit IDs (next_id)

**File:** `src/lib/id/next-id.ts`

Pattern: `41 bits timestamp + 13 bits shard + 10 bits counter = 64 bits`

```
0 - 41 bits timestamp (ms since 2024-01-01) - 13 bits shard (8192) - 10 bits counter (1024)
```

- **Timestamp:** 41 bits = ~69 years from custom epoch (2024-01-01)
- **Shard:** 13 bits = 8192 logical shards (aligns with image sharding)
- **Counter:** 10 bits = 1024 IDs per ms per shard = ~1M IDs/sec per shard
- **Sortable:** IDs are k-sorted by time
- **No clash:** Each shard has independent counter, no coordination
- **Env:** `ID_SHARD_ID` default shard for instance, or derived from HOSTNAME
- **APIs:**
  - `nextId(shardId?)` -> string (safe for JSON/Postgres bigint)
  - `nextIdBigInt(shardId?)` -> bigint
  - `parseId(id)` -> { timestamp, shardId, counter }
  - `getShardFromId(id)`
  - `sortIds(ids)` -> chronologically sorted
  - `nextIds(count, shardId)` -> batch
  - `imageShardToIdShard(imageShard)` -> maps image shard to ID shard

**Example:**
```ts
import { nextId, parseId } from "@/lib/id/next-id"
const id = nextId(42) // shard 42
console.log(parseId(id)) // { timestamp: Date, shardId: 42, counter: 0 }
```

## Integration

**File:** `src/lib/db.ts` (enhanced)

- Uses PgBouncer pool if enabled
- Routes reads to replicas + Memcached
- Routes every read through the request guard (positive cache → negative cache
  → Bloom filter → rate limited, coalesced database query)
- Writes to primary + invalidates the caches of the table they touched
- `getRawSql()` — the unguarded client (the guard's metadata queries, and
  maintenance work that must see the real state)
- Re-exports all scalability modules for convenience

**Example usage:** `src/lib/db/example-usage.ts`

## Env Summary

| Feature | Env Vars |
|---------|----------|
| PgBouncer | `DATABASE_URL`, `PGBOUNCER_URL`, `PGBOUNCER_ENABLED`, `PGBOUNCER_POOL_MODE`, `PGBOUNCER_MAX_POOL_SIZE`, `PGBOUNCER_STATEMENT_TIMEOUT_MS` |
| Replicas | `DATABASE_REPLICA_URLS`, `READ_REPLICA_URLS`, `DATABASE_REPLICA_URL`, `REPLICA_ROUTING_ENABLED`, `REPLICA_MAX_LAG_MS` |
| Memcached | `MEMCACHED_SERVERS`, `MEMCACHED_URL`, `MEMCACHED_ENABLED`, `MEMCACHED_DEFAULT_TTL`, `MEMCACHED_MAX_KEYS` |
| Rate limit (HTTP) | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SEC`, `RATE_LIMIT_BURST`, `RATE_LIMIT_STATIC_MAX`, `RATE_LIMIT_AUTH_MAX` |
| Negative cache | `NEGATIVE_CACHE_ENABLED`, `NEGATIVE_CACHE_TTL_SEC`, `NEGATIVE_CACHE_MAX_KEYS` |
| Bloom filter | `BLOOM_FILTER_ENABLED`, `BLOOM_FILTER_MAX_SCAN_ROWS`, `BLOOM_FILTER_TTL_SEC`, `BLOOM_FILTER_TRUST_LOCAL` |
| Database load | `DB_RATE_LIMIT_ENABLED`, `DB_RATE_LIMIT_MAX`, `DB_RATE_LIMIT_WINDOW_SEC`, `DB_MAX_CONCURRENT_QUERIES`, `DB_MAX_QUEUED_QUERIES`, `CACHE_DEFAULT_TTL_SEC` |
| Image Sharding | `IMAGE_LOGICAL_SHARDS`, `IMAGE_PHYSICAL_MACHINES`, `IMAGE_SHARD_MAP_VERSION`, `IMAGE_STORAGE_PREFIX` |
| IDs | `ID_SHARD_ID`, `HOSTNAME` |

## Testing

```bash
npm run build # should pass
npx tsc --noEmit # typecheck
npm test        # unit tests + the guard integration test
```

All modules have in-memory fallbacks so they work without external services in preview/dev.

The guard has its own tests:

| Test | What it proves |
|---|---|
| `src/lib/cache/bloom.test.ts` | no false negatives, bounded false positives, saturation degrades safely |
| `src/lib/cache/negative.test.ts` | markers, namespaces, TTL expiry, write invalidation |
| `src/lib/cache/rate-limit.test.ts` | token bucket, burst, refill, concurrency cap, client keys |
| `src/lib/cache/db-guard.test.ts` | query analysis, negative cache, Bloom filter, coalescing |
| `scripts/guard-db.test.mjs` | the guard against the **real** database layer (PGLite): a missing key costs one query, a later row is visible immediately, a write drops the cached rows |

