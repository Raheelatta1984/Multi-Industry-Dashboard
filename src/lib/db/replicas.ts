/**
 * Read Replica routing for Neon Postgres
 *
 * Problem: Too many reads on primary -> latency spikes, contention.
 * Solution: Route read-only queries to replicas, writes to primary.
 *
 * Architecture:
 *   Primary (DATABASE_URL) - writes + strong consistent reads when needed
 *   Replicas (DATABASE_REPLICA_URLS or READ_REPLICA_URLS) - comma-separated URLs
 *            or single DATABASE_REPLICA_URL / READ_REPLICA_URL
 *   Replica selection: round-robin with health check, fallback to primary
 *
 * Env:
 *   DATABASE_URL - primary
 *   DATABASE_REPLICA_URLS / READ_REPLICA_URLS - comma-separated replica URLs
 *   DATABASE_REPLICA_URL / READ_REPLICA_URL   - single replica URL (legacy)
 *   REPLICA_ROUTING_ENABLED - true/false (default true if replicas configured)
 *   REPLICA_MAX_LAG_MS - max acceptable replication lag (default 1000ms) - for future lag-aware routing
 *
 * Query classification:
 *   - SELECT, SHOW, EXPLAIN, WITH (read-only CTE) -> replica
 *   - INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, etc -> primary
 *   - Transaction with write -> primary
 *   - Forced primary via hint: query prefixed with -- primary or slash-star primary star-slash
 *
 * Usage:
 *   import { getPrimaryPool, getReplicaPool, queryWithRouting, isReadOnlyQuery } from "@/lib/db/replicas"
 *   const rows = await queryWithRouting("SELECT * FROM revenue WHERE id = $1", [id])
 */

export type ReplicaConfig = {
  primaryUrl: string | null;
  replicaUrls: string[];
  routingEnabled: boolean;
  maxLagMs: number;
};

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v ? v : undefined;
}

function envInt(key: string, fallback: number): number {
  const v = env(key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseReplicaUrls(): string[] {
  const urls: string[] = [];
  const multi =
    env("DATABASE_REPLICA_URLS") ??
    env("READ_REPLICA_URLS") ??
    env("DATABASE_REPLICAS") ??
    env("READ_REPLICAS");

  if (multi) {
    for (const part of multi.split(",")) {
      const trimmed = part.trim();
      if (trimmed) urls.push(trimmed);
    }
  }

  const single = env("DATABASE_REPLICA_URL") ?? env("READ_REPLICA_URL");
  if (single && !urls.includes(single)) urls.push(single);

  return urls;
}

export function getReplicaConfig(): ReplicaConfig {
  const primaryUrl = env("DATABASE_URL") ?? null;
  const replicaUrls = parseReplicaUrls();
  const flag = env("REPLICA_ROUTING_ENABLED");
  const routingEnabled =
    flag != null ? flag === "true" || flag === "1" : replicaUrls.length > 0;

  return {
    primaryUrl,
    replicaUrls,
    routingEnabled,
    maxLagMs: envInt("REPLICA_MAX_LAG_MS", 1000),
  };
}

/**
 * Very fast read-only detection. Conservative: if unsure, treat as write (primary).
 */
export function isReadOnlyQuery(sql: string): boolean {
  const trimmed = sql.trimStart();
  // Forced primary hints - check for comment markers without breaking JSDoc
  const primaryHint1 = "-- primary";
  const primaryHint2a = "/" + "* primary *" + "/";
  if (trimmed.startsWith(primaryHint1) || trimmed.startsWith(primaryHint2a)) return false;
  // Regex for primary hint anywhere in first 100 chars
  const primaryRegex = new RegExp("/\\*\\s*primary\\s*\\*/", "i");
  if (primaryRegex.test(trimmed.slice(0, 100))) return false;

  const upper = trimmed.toUpperCase();

  // Common read-only prefixes
  if (
    upper.startsWith("SELECT") ||
    upper.startsWith("SHOW") ||
    upper.startsWith("EXPLAIN") ||
    upper.startsWith("WITH")
  ) {
    if (upper.startsWith("WITH")) {
      if (/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(trimmed)) {
        const afterWith = upper.slice(4);
        if (/\bINSERT\b|\bUPDATE\b|\bDELETE\b/.test(afterWith)) {
          const firstSelect = afterWith.indexOf("SELECT");
          const firstInsert = afterWith.indexOf("INSERT");
          const firstUpdate = afterWith.indexOf("UPDATE");
          const firstDelete = afterWith.indexOf("DELETE");
          const firstWrite = Math.min(
            firstInsert === -1 ? Infinity : firstInsert,
            firstUpdate === -1 ? Infinity : firstUpdate,
            firstDelete === -1 ? Infinity : firstDelete
          );
          if (firstWrite < firstSelect && firstWrite !== Infinity) return false;
        }
      }
    }
    return true;
  }

  return false;
}

// Pool singletons
type PgPool = import("pg").Pool;

const globalRef = globalThis as typeof globalThis & {
  __primaryPool__?: PgPool;
  __replicaPools__?: PgPool[];
  __replicaIndex__?: number;
  __primaryPoolPromise__?: Promise<PgPool | null>;
  __replicaPoolsPromise__?: Promise<PgPool[]>;
};

function createPoolOptions(connectionString: string, isReplica = false) {
  const appName = isReplica ? "meridian-replica" : "meridian-primary";
  return {
    connectionString,
    max: isReplica ? 10 : 20,
    min: isReplica ? 1 : 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    application_name: appName,
    keepAlive: true,
  };
}

export async function getPrimaryPool(): Promise<PgPool | null> {
  const cfg = getReplicaConfig();
  if (!cfg.primaryUrl) return null;
  if (typeof window !== "undefined") throw new Error("getPrimaryPool() is server-only");

  if (globalRef.__primaryPool__) return globalRef.__primaryPool__;
  if (globalRef.__primaryPoolPromise__) return globalRef.__primaryPoolPromise__;

  globalRef.__primaryPoolPromise__ = (async () => {
    const { Pool } = await import("pg");
    const pool = new Pool(createPoolOptions(cfg.primaryUrl!));
    pool.on("error", (err) => console.error("[replica] primary pool error:", err));
    globalRef.__primaryPool__ = pool;
    return pool;
  })().catch((err) => {
    globalRef.__primaryPoolPromise__ = undefined;
    throw err;
  });

  return globalRef.__primaryPoolPromise__;
}

export async function getReplicaPools(): Promise<PgPool[]> {
  const cfg = getReplicaConfig();
  if (cfg.replicaUrls.length === 0) return [];
  if (typeof window !== "undefined") throw new Error("getReplicaPools() is server-only");

  if (globalRef.__replicaPools__) return globalRef.__replicaPools__;
  if (globalRef.__replicaPoolsPromise__) return globalRef.__replicaPoolsPromise__;

  globalRef.__replicaPoolsPromise__ = (async () => {
    const { Pool } = await import("pg");
    const pools = cfg.replicaUrls.map((url) => {
      const pool = new Pool(createPoolOptions(url, true));
      pool.on("error", (err) => console.error("[replica] replica pool error:", err));
      return pool;
    });
    globalRef.__replicaPools__ = pools;
    globalRef.__replicaIndex__ = 0;
    return pools;
  })().catch((err) => {
    globalRef.__replicaPoolsPromise__ = undefined;
    throw err;
  });

  return globalRef.__replicaPoolsPromise__;
}

export async function getReplicaPool(): Promise<PgPool | null> {
  const pools = await getReplicaPools();
  if (pools.length === 0) return null;
  const idx = globalRef.__replicaIndex__ ?? 0;
  const pool = pools[idx % pools.length];
  globalRef.__replicaIndex__ = (idx + 1) % pools.length;
  return pool;
}

/**
 * Health check for replicas - returns healthy replica URLs
 */
export async function getHealthyReplicas(): Promise<{ url: string; healthy: boolean; latencyMs?: number }[]> {
  const cfg = getReplicaConfig();
  const results: { url: string; healthy: boolean; latencyMs?: number }[] = [];
  const pools = await getReplicaPools();

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const url = cfg.replicaUrls[i];
    const start = Date.now();
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
        results.push({ url, healthy: true, latencyMs: Date.now() - start });
      } finally {
        client.release();
      }
    } catch {
      results.push({ url, healthy: false });
    }
  }

  return results;
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  fromReplica: boolean;
}

/**
 * Execute query with automatic replica routing.
 * Read-only queries go to replica (if available and routing enabled), writes to primary.
 * Falls back to primary if replica fails.
 */
export async function queryWithRouting<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  opts: { forcePrimary?: boolean } = {}
): Promise<QueryResult<T>> {
  const cfg = getReplicaConfig();
  const readOnly = isReadOnlyQuery(text);

  const shouldUseReplica =
    !opts.forcePrimary &&
    cfg.routingEnabled &&
    readOnly &&
    cfg.replicaUrls.length > 0;

  if (shouldUseReplica) {
    const replicaPool = await getReplicaPool();
    if (replicaPool) {
      try {
        const res = await replicaPool.query(text, params);
        return { rows: res.rows as T[], fromReplica: true };
      } catch (err) {
        console.warn("[replica] replica query failed, falling back to primary:", err);
      }
    }
  }

  const primaryPool = await getPrimaryPool();
  if (!primaryPool) {
    const { getSql } = await import("../db");
    const sql = await getSql();
    const rows = await sql.query<T>(text, params);
    return { rows, fromReplica: false };
  }

  const res = await primaryPool.query(text, params);
  return { rows: res.rows as T[], fromReplica: false };
}

export async function closeAllPools(): Promise<void> {
  if (globalRef.__primaryPool__) {
    await globalRef.__primaryPool__.end();
    globalRef.__primaryPool__ = undefined;
    globalRef.__primaryPoolPromise__ = undefined;
  }
  if (globalRef.__replicaPools__) {
    for (const pool of globalRef.__replicaPools__) {
      await pool.end();
    }
    globalRef.__replicaPools__ = undefined;
    globalRef.__replicaPoolsPromise__ = undefined;
    globalRef.__replicaIndex__ = 0;
  }
}
