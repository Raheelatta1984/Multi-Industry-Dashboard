/**
 * PgBouncer integration for Neon Postgres
 *
 * Neon already provides built-in pooling via its pooled endpoint (e.g. *-pooler),
 * but for high-concurrency workloads we add an explicit PgBouncer layer.
 *
 * Why PgBouncer?
 * - Transaction pooling: thousands of app server connections multiplexed to few Postgres connections
 * - Reduces Neon compute wake-ups and connection overhead
 * - Protects against connection storms (serverless scale-out)
 * - Allows query queuing, prepared statement handling, and statement_timeout enforcement
 *
 * Configuration via env:
 *   DATABASE_URL              - primary (Neon) URL
 *   PGBOUNCER_URL             - optional dedicated pgbouncer URL (if you run pgbouncer externally)
 *   PGBOUNCER_ENABLED         - "true" to force pgbouncer pool even if PGBOUNCER_URL not set
 *   PGBOUNCER_POOL_MODE       - "transaction" (default) | "session" | "statement"
 *   PGBOUNCER_MAX_CLIENT_CONN - max client connections (default 1000)
 *   PGBOUNCER_DEFAULT_POOL_SIZE - default pool size per database (default 20)
 *   PGBOUNCER_RESERVE_POOL_SIZE - reserve pool (default 5)
 *
 * If PGBOUNCER_URL is not set but PGBOUNCER_ENABLED=true, we reuse DATABASE_URL
 * but configure the pg.Pool to behave pgbouncer-friendly:
 *   - disable statement_timeout via pool options
 *   - set application_name
 *   - use transaction pooling semantics (no prepared statements that outlive tx)
 *
 * Usage:
 *   import { getPgbouncerPool, getPgbouncerConfig } from "@/lib/db/pgbouncer"
 *   const pool = await getPgbouncerPool()
 */

export type PgbouncerPoolMode = "transaction" | "session" | "statement";

export interface PgbouncerConfig {
  enabled: boolean;
  poolMode: PgbouncerPoolMode;
  connectionString: string | null; // effective URL to connect to
  rawDatabaseUrl: string | null;
  pgbouncerUrl: string | null;
  maxClientConn: number;
  defaultPoolSize: number;
  reservePoolSize: number;
  maxPoolSize: number; // pg Pool max
  minPoolSize: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMs: number;
  applicationName: string;
}

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

function parsePoolMode(v: string | undefined): PgbouncerPoolMode {
  if (v === "session" || v === "statement" || v === "transaction") return v;
  return "transaction";
}

/**
 * Build pgbouncer config from environment.
 * Safe to call in any environment (returns disabled if no DATABASE_URL).
 */
export function getPgbouncerConfig(): PgbouncerConfig {
  const rawDatabaseUrl = env("DATABASE_URL") ?? null;
  const pgbouncerUrl = env("PGBOUNCER_URL") ?? null;
  const enabledFlag = env("PGBOUNCER_ENABLED");
  const explicitlyEnabled = enabledFlag === "true" || enabledFlag === "1";

  // Enabled if PGBOUNCER_URL present OR PGBOUNCER_ENABLED=true and DATABASE_URL exists
  const enabled = Boolean(pgbouncerUrl || (explicitlyEnabled && rawDatabaseUrl));

  // Effective connection string: prefer PGBOUNCER_URL, fallback to DATABASE_URL
  const connectionString = pgbouncerUrl ?? rawDatabaseUrl ?? null;

  const poolMode = parsePoolMode(env("PGBOUNCER_POOL_MODE"));

  return {
    enabled,
    poolMode,
    connectionString,
    rawDatabaseUrl,
    pgbouncerUrl,
    maxClientConn: envInt("PGBOUNCER_MAX_CLIENT_CONN", 1000),
    defaultPoolSize: envInt("PGBOUNCER_DEFAULT_POOL_SIZE", 20),
    reservePoolSize: envInt("PGBOUNCER_RESERVE_POOL_SIZE", 5),
    maxPoolSize: envInt("PGBOUNCER_MAX_POOL_SIZE", 20),
    minPoolSize: envInt("PGBOUNCER_MIN_POOL_SIZE", 2),
    idleTimeoutMillis: envInt("PGBOUNCER_IDLE_TIMEOUT_MS", 10000),
    connectionTimeoutMillis: envInt("PGBOUNCER_CONNECTION_TIMEOUT_MS", 5000),
    statementTimeoutMs: envInt("PGBOUNCER_STATEMENT_TIMEOUT_MS", 30000),
    applicationName: env("PGBOUNCER_APP_NAME") ?? "meridian-pgbouncer",
  };
}

/**
 * Pg Pool options optimized for PgBouncer transaction pooling.
 * Key rules for transaction mode:
 * - Avoid prepared statements that live across transactions (pg does this by default with named prepared statements)
 * - Use DISCARD ALL properly (pg does)
 * - Set statement_timeout to prevent runaway queries holding connections
 */
export function getPgbouncerPoolOptions() {
  const cfg = getPgbouncerConfig();
  if (!cfg.connectionString) return null;

  return {
    connectionString: cfg.connectionString,
    max: cfg.maxPoolSize,
    min: cfg.minPoolSize,
    idleTimeoutMillis: cfg.idleTimeoutMillis,
    connectionTimeoutMillis: cfg.connectionTimeoutMillis,
    application_name: cfg.applicationName,
    // PgBouncer transaction mode best practices
    // We set statement_timeout via query config, not pool, but we also set it as a connection param
    options: `-c statement_timeout=${cfg.statementTimeoutMs}`,
    // Neon-specific: keepalive
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };
}

// Global singleton for pgbouncer pool (server-only)
type PgPool = import("pg").Pool;
const globalRef = globalThis as typeof globalThis & {
  __pgbouncerPool__?: PgPool;
  __pgbouncerPoolPromise__?: Promise<PgPool>;
};

export async function getPgbouncerPool(): Promise<PgPool | null> {
  const cfg = getPgbouncerConfig();
  if (!cfg.enabled || !cfg.connectionString) return null;
  if (typeof window !== "undefined") {
    throw new Error("getPgbouncerPool() is server-only");
  }

  if (globalRef.__pgbouncerPool__) return globalRef.__pgbouncerPool__;
  if (globalRef.__pgbouncerPoolPromise__) return globalRef.__pgbouncerPoolPromise__;

  globalRef.__pgbouncerPoolPromise__ = (async () => {
    const { Pool } = await import("pg");
    const opts = getPgbouncerPoolOptions();
    if (!opts) throw new Error("No connection string for PgBouncer");
    const pool = new Pool(opts);

    // Event listeners for observability
    pool.on("connect", () => {
      // console.debug("[pgbouncer] new client connected");
    });
    pool.on("error", (err) => {
      console.error("[pgbouncer] pool error:", err);
    });

    // Verify connectivity with a lightweight query, set statement_timeout
    try {
      const client = await pool.connect();
      try {
        await client.query(`SET statement_timeout = ${cfg.statementTimeoutMs}`);
        await client.query(`SET application_name = '${cfg.applicationName}'`);
      } finally {
        client.release();
      }
    } catch (e) {
      console.warn("[pgbouncer] initial connection check failed, pool still created:", e);
    }

    globalRef.__pgbouncerPool__ = pool;
    return pool;
  })().catch((err) => {
    globalRef.__pgbouncerPoolPromise__ = undefined;
    throw err;
  });

  return globalRef.__pgbouncerPoolPromise__;
}

export async function closePgbouncerPool(): Promise<void> {
  const pool = globalRef.__pgbouncerPool__;
  if (pool) {
    await pool.end();
    globalRef.__pgbouncerPool__ = undefined;
    globalRef.__pgbouncerPoolPromise__ = undefined;
  }
}

/**
 * Example pgbouncer.ini for self-hosted deployment (generate for ops)
 */
export function generatePgbouncerIni(): string {
  const cfg = getPgbouncerConfig();
  return `; Auto-generated PgBouncer config for Meridian
[databases]
; Use Neon connection string here - example:
; meridian = host=ep-xxx.neon.tech port=5432 dbname=neondb user=neon_user password=xxx sslmode=require
; For Neon pooled endpoint, point to the pooler host

[pgbouncer]
listen_port = 6432
listen_addr = 0.0.0.0
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt

; Pooling mode - transaction is best for serverless / high concurrency
pool_mode = ${cfg.poolMode}
max_client_conn = ${cfg.maxClientConn}
default_pool_size = ${cfg.defaultPoolSize}
reserve_pool_size = ${cfg.reservePoolSize}
reserve_pool_timeout = 5

; Timeouts
server_reset_query = DISCARD ALL
server_check_delay = 30
server_check_query = SELECT 1
server_lifetime = 3600
server_idle_timeout = 600

; Logging
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1

; Security
ignore_startup_parameters = extra_float_digits

[users]
; Define users that can connect via pgbouncer
`;
}
