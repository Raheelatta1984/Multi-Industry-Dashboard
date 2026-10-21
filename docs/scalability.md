# Scalability Architecture

This document describes the four scalability improvements implemented to handle high traffic, avoid ID clashes, and scale image storage.

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

## 3. Logical Shards + Machine Map for Images

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

## 4. Distributed 64-bit IDs (next_id)

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
- Writes to primary + invalidates cache
- Re-exports all scalability modules for convenience

**Example usage:** `src/lib/db/example-usage.ts`

## Env Summary

| Feature | Env Vars |
|---------|----------|
| PgBouncer | `DATABASE_URL`, `PGBOUNCER_URL`, `PGBOUNCER_ENABLED`, `PGBOUNCER_POOL_MODE`, `PGBOUNCER_MAX_POOL_SIZE`, `PGBOUNCER_STATEMENT_TIMEOUT_MS` |
| Replicas | `DATABASE_REPLICA_URLS`, `READ_REPLICA_URLS`, `DATABASE_REPLICA_URL`, `REPLICA_ROUTING_ENABLED`, `REPLICA_MAX_LAG_MS` |
| Memcached | `MEMCACHED_SERVERS`, `MEMCACHED_URL`, `MEMCACHED_ENABLED`, `MEMCACHED_DEFAULT_TTL`, `MEMCACHED_MAX_KEYS` |
| Image Sharding | `IMAGE_LOGICAL_SHARDS`, `IMAGE_PHYSICAL_MACHINES`, `IMAGE_SHARD_MAP_VERSION`, `IMAGE_STORAGE_PREFIX` |
| IDs | `ID_SHARD_ID`, `HOSTNAME` |

## Testing

```bash
npm run build # should pass
npx tsc --noEmit # typecheck
```

All modules have in-memory fallbacks so they work without external services in preview/dev.
