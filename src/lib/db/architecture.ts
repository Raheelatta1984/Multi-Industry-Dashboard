/**
 * Scalability Architecture Overview
 *
 * This file documents how the requested scalability features work together.
 *
 * 1. PgBouncer (Neon + PgBouncer)
 *    - Neon already has a pooled endpoint, but PgBouncer adds transaction pooling
 *    - Configured via PGBOUNCER_URL or PGBOUNCER_ENABLED=true
 *    - Pool mode: transaction (default) multiplexes many app connections to few PG connections
 *    - See src/lib/db/pgbouncer.ts
 *
 * 2. Read Replicas + Memcached
 *    - Too many reads? Route SELECTs to replicas
 *    - Replicas configured via DATABASE_REPLICA_URLS (comma-separated)
 *    - Round-robin with fallback to primary
 *    - Memcached caches hot read queries (dashboard boards, FX, revenue)
 *    - Cache-aside: check cache -> miss -> query replica/primary -> populate
 *    - On writes, invalidate relevant cache keys
 *    - See src/lib/db/replicas.ts and src/lib/cache/memcached.ts
 *
 * 2b. Request Guard (rate limiting, negative cache, Bloom filter)
 *    - Every request is rate limited (token bucket per client -> 429 + Retry-After)
 *    - Empty query results and 404s are remembered (negative cache), so a
 *      repeated miss never reaches the database; a write clears the markers
 *    - Point lookups are answered from a Bloom filter of the table's primary
 *      keys when the key is definitely absent (the filter is only believed
 *      when no row can have been inserted after its snapshot)
 *    - Identical concurrent reads are coalesced into one query; queries are
 *      rate limited and concurrency limited
 *    - See src/lib/cache/db-guard.ts and src/lib/cache/request-guard.server.ts
 *
 * 3. Logical Shards + Machine Map for Images
 *    - Images sharded across 1024 logical shards (fixed)
 *    - Logical shards mapped to physical machines via machine map (versioned)
 *    - Adding machines only moves subset of shards (consistent hashing)
 *    - Path: prefix / machine / shard / subdir / imageId.ext
 *    - See src/lib/storage/image-sharding.ts
 *
 * 4. next_id with 64-bit pattern (41-13-10)
 *    - 41 bits timestamp (ms since 2024-01-01) = 69 years
 *    - 13 bits shard reference = 8192 shards
 *    - 10 bits counter = 1024 IDs per ms per shard
 *    - Sortable, no coordination, no clash
 *    - See src/lib/id/next-id.ts
 *
 * Data flow example:
 *
 *   User uploads image + creates dashboard row
 *   -> nextId(shard) generates sortable ID (no clash)
 *   -> resolveImageLocation(id) finds machine via logical shard
 *   -> Store image on that machine
 *   -> Write metadata to primary (via PgBouncer pool)
 *   -> Invalidate memcached for affected boards
 *   -> Subsequent reads:
 *        - Check memcached (hit? return)
 *        - Else query replica (round-robin)
 *        - Populate cache
 *
 * Read path with the request guard:
 *   Request
 *     -> rate limited per client (429 before anything else)
 *     -> positive cache hit? return
 *     -> negative marker? return empty (no database round trip)
 *     -> point lookup + Bloom filter says "definitely absent"? return empty
 *     -> database (rate limited, concurrency limited, coalesced)
 *
 * Env summary:
 *   DATABASE_URL - primary Neon URL
 *   PGBOUNCER_URL / PGBOUNCER_ENABLED / PGBOUNCER_POOL_MODE - pgbouncer
 *   DATABASE_REPLICA_URLS / READ_REPLICA_URLS - replicas
 *   MEMCACHED_SERVERS / MEMCACHED_URL / MEMCACHED_ENABLED - cache
 *   RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SEC / RATE_LIMIT_AUTH_MAX - http rate limit
 *   NEGATIVE_CACHE_ENABLED / NEGATIVE_CACHE_TTL_SEC - negative cache
 *   BLOOM_FILTER_ENABLED / BLOOM_FILTER_MAX_SCAN_ROWS - bloom filter
 *   DB_RATE_LIMIT_MAX / DB_MAX_CONCURRENT_QUERIES - database load
 *   IMAGE_LOGICAL_SHARDS / IMAGE_PHYSICAL_MACHINES / IMAGE_SHARD_MAP_VERSION - image sharding
 *   ID_SHARD_ID - default shard for ID generator
 */

export const ARCHITECTURE_VERSION = "1.1.0";

export const SCALABILITY_FEATURES = {
  pgbouncer: {
    enabled: true,
    file: "src/lib/db/pgbouncer.ts",
    env: ["DATABASE_URL", "PGBOUNCER_URL", "PGBOUNCER_ENABLED", "PGBOUNCER_POOL_MODE"],
  },
  readReplicas: {
    enabled: true,
    file: "src/lib/db/replicas.ts",
    env: ["DATABASE_URL", "DATABASE_REPLICA_URLS", "READ_REPLICA_URLS", "REPLICA_ROUTING_ENABLED"],
  },
  memcached: {
    enabled: true,
    file: "src/lib/cache/memcached.ts",
    env: ["MEMCACHED_SERVERS", "MEMCACHED_URL", "MEMCACHED_ENABLED", "MEMCACHED_DEFAULT_TTL"],
  },
  requestGuard: {
    enabled: true,
    files: [
      "src/lib/cache/request-guard.server.ts",
      "src/lib/cache/db-guard.ts",
      "src/lib/cache/bloom.ts",
      "src/lib/cache/negative.ts",
      "src/lib/cache/rate-limit.ts",
      "src/lib/cache/single-flight.ts",
    ],
    env: [
      "RATE_LIMIT_ENABLED",
      "RATE_LIMIT_MAX",
      "RATE_LIMIT_WINDOW_SEC",
      "RATE_LIMIT_STATIC_MAX",
      "RATE_LIMIT_AUTH_MAX",
      "NEGATIVE_CACHE_ENABLED",
      "NEGATIVE_CACHE_TTL_SEC",
      "BLOOM_FILTER_ENABLED",
      "BLOOM_FILTER_MAX_SCAN_ROWS",
      "BLOOM_FILTER_TRUST_LOCAL",
      "DB_RATE_LIMIT_MAX",
      "DB_RATE_LIMIT_WINDOW_SEC",
      "DB_MAX_CONCURRENT_QUERIES",
    ],
  },
  imageSharding: {
    enabled: true,
    file: "src/lib/storage/image-sharding.ts",
    env: ["IMAGE_LOGICAL_SHARDS", "IMAGE_PHYSICAL_MACHINES", "IMAGE_SHARD_MAP_VERSION"],
  },
  nextId: {
    enabled: true,
    file: "src/lib/id/next-id.ts",
    pattern: "41 bits timestamp + 13 bits shard + 10 bits counter = 64 bits",
    env: ["ID_SHARD_ID"],
  },
} as const;
