/**
 * Rate limiting — two complementary brakes on server load.
 *
 * 1. **Token bucket (rate)** — limits how many requests a client may make in a
 *    window. A burst is allowed up to the bucket size; the bucket refills
 *    continuously at `limit / windowSec`. Exceeding it answers `429` with
 *    `Retry-After` instead of letting the request reach the database.
 *
 * 2. **Concurrency limiter (load)** — caps how many expensive operations run
 *    at the same time. Rate limiting alone does not stop a burst of 50
 *    requests that each take 2 seconds; a concurrency cap does, and it keeps
 *    the connection pool from being drained.
 *
 * Both are per-process, in-memory and dependency-free. On a serverless fleet
 * each instance keeps its own bucket, which is the standard behaviour: the
 * limit becomes "per instance", and the shared cache (see `memcached.ts`) can
 * be used to widen it when a fleet-wide budget is needed.
 *
 * Env:
 *   RATE_LIMIT_ENABLED        - "false" turns the HTTP limiter off
 *   RATE_LIMIT_MAX            - requests per window per client (default 300)
 *   RATE_LIMIT_WINDOW_SEC     - window length (default 60)
 *   RATE_LIMIT_BURST          - bucket size (default = RATE_LIMIT_MAX)
 *   RATE_LIMIT_STATIC_MAX     - bucket size for static assets (default 1200)
 *   RATE_LIMIT_AUTH_MAX       - bucket size for /api/auth (default 30)
 *   DB_RATE_LIMIT_MAX         - queries per window per process (default 600)
 *   DB_RATE_LIMIT_WINDOW_SEC  - window length (default 60)
 *   DB_MAX_CONCURRENT_QUERIES - in-flight queries (default 20)
 */

export interface RateLimitOptions {
  /** Sustained requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Bucket size — how large a burst may be. Defaults to `limit`. */
  burst?: number;
}

export interface RateLimitDecision {
  /** Did the request fit in the budget? */
  allowed: boolean;
  /** The configured limit (for the `X-RateLimit-Limit` header). */
  limit: number;
  /** Tokens left in the bucket (for the `X-RateLimit-Remaining` header). */
  remaining: number;
  /** Epoch ms when the bucket is expected to be full again. */
  resetAt: number;
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfterSec: number;
}

export interface RateLimiterStats {
  /** Buckets currently tracked. */
  keys: number;
  /** Requests allowed since start. */
  allowed: number;
  /** Requests rejected since start. */
  denied: number;
}

type Bucket = {
  tokens: number;
  updatedAt: number;
};

/** Thrown when a caller exceeds a limit. Carries the retry hint. */
export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSec: number;
  readonly limit: number;

  constructor(message: string, retryAfterSec: number, limit: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSec = retryAfterSec;
    this.limit = limit;
  }
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowSec: number;
  private readonly burst: number;
  private readonly refillPerSec: number;
  private allowedCount = 0;
  private deniedCount = 0;
  private callsSinceSweep = 0;

  constructor(options: RateLimitOptions) {
    this.limit = Math.max(1, Math.floor(options.limit));
    this.windowSec = Math.max(0.001, options.windowSec);
    this.burst = Math.max(1, Math.floor(options.burst ?? options.limit));
    this.refillPerSec = this.limit / this.windowSec;
  }

  /** The configured sustained limit. */
  get limitValue(): number {
    return this.limit;
  }

  /** The configured burst size. */
  get burstValue(): number {
    return this.burst;
  }

  /**
   * Take `cost` tokens from the bucket of `key`.
   *
   * A denied call does **not** consume tokens, so a client that hammers a
   * closed door does not push its own recovery further into the future.
   */
  consume(key: string, cost = 1): RateLimitDecision {
    const now = Date.now();
    const bucket = this.bucketFor(key, now);
    const refill = ((now - bucket.updatedAt) / 1000) * this.refillPerSec;
    bucket.tokens = Math.min(this.burst, bucket.tokens + refill);
    bucket.updatedAt = now;

    this.sweep(now);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.allowedCount++;
      return {
        allowed: true,
        limit: this.limit,
        remaining: Math.floor(bucket.tokens),
        resetAt: now + Math.ceil((this.burst - bucket.tokens) / this.refillPerSec * 1000),
        retryAfterSec: 0,
      };
    }

    this.deniedCount++;
    const deficit = cost - bucket.tokens;
    const retryAfterSec = Math.max(1, Math.ceil(deficit / this.refillPerSec));
    return {
      allowed: false,
      limit: this.limit,
      remaining: 0,
      resetAt: now + retryAfterSec * 1000,
      retryAfterSec,
    };
  }

  /** Look at a bucket without spending tokens. */
  peek(key: string): RateLimitDecision {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return {
        allowed: true,
        limit: this.limit,
        remaining: this.burst,
        resetAt: now,
        retryAfterSec: 0,
      };
    }
    const refill = ((now - bucket.updatedAt) / 1000) * this.refillPerSec;
    const tokens = Math.min(this.burst, bucket.tokens + refill);
    return {
      allowed: tokens >= 1,
      limit: this.limit,
      remaining: Math.floor(tokens),
      resetAt: now + Math.ceil((this.burst - tokens) / this.refillPerSec * 1000),
      retryAfterSec: 0,
    };
  }

  /** Forget one bucket (e.g. after a successful sign-in). */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Forget every bucket. */
  resetAll(): void {
    this.buckets.clear();
  }

  stats(): RateLimiterStats {
    return {
      keys: this.buckets.size,
      allowed: this.allowedCount,
      denied: this.deniedCount,
    };
  }

  private bucketFor(key: string, now: number): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.burst, updatedAt: now };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /** Drop buckets that have been idle for two windows (keeps memory flat). */
  private sweep(now: number): void {
    this.callsSinceSweep++;
    if (this.callsSinceSweep < 512 && this.buckets.size < 10_000) return;
    this.callsSinceSweep = 0;
    const idleMs = this.windowSec * 2000;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > idleMs) this.buckets.delete(key);
    }
  }
}

/**
 * Caps the number of operations running at once.
 *
 * Work beyond `maxConcurrent` waits in a bounded queue; work beyond
 * `maxQueue` is rejected immediately with a {@link RateLimitError} — a fast,
 * honest failure beats an unbounded queue that turns into a timeout storm.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;

  constructor(maxConcurrent: number, maxQueue = 0) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.maxQueue = Math.max(0, Math.floor(maxQueue));
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiting.length;
  }

  get limit(): number {
    return this.maxConcurrent;
  }

  /** Run `fn` under the cap. Rejects with {@link RateLimitError} when full. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.waiting.length >= this.maxQueue) {
        throw new RateLimitError(
          "Too many concurrent operations in flight",
          1,
          this.maxConcurrent,
        );
      }
      // Wait for a slot. The slot is handed over by the task that finishes.
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}

// ---------------------------------------------------------------------------
// Client identification
// ---------------------------------------------------------------------------

/**
 * Identify the caller for rate limiting.
 *
 * The proxy in front of the app sets `x-forwarded-for`; the first entry is the
 * original client. Falls back to the other common proxy headers and finally to
 * a shared "unknown" bucket, so an unidentified client is still limited.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;
  const vercelIp = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelIp) return vercelIp.split(",")[0]!.trim();
  return "unknown";
}

/** Standard headers so clients (and the demo page) can see the budget. */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(Math.max(0, decision.remaining)),
    "X-RateLimit-Reset": String(Math.ceil(decision.resetAt / 1000)),
  };
}

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function envFlag(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  return raw !== "false" && raw !== "0" && raw !== "off";
}

export interface HttpRateLimitConfig {
  enabled: boolean;
  /** Bucket for page/API requests. */
  max: number;
  /** Bucket for static assets. */
  staticMax: number;
  /** Bucket for authentication endpoints. */
  authMax: number;
  windowSec: number;
}

export function getHttpRateLimitConfig(): HttpRateLimitConfig {
  const windowSec = envInt("RATE_LIMIT_WINDOW_SEC", 60);
  const max = envInt("RATE_LIMIT_MAX", 300);
  return {
    enabled: envFlag("RATE_LIMIT_ENABLED", true),
    max,
    staticMax: envInt("RATE_LIMIT_STATIC_MAX", Math.max(max * 4, 1200)),
    authMax: envInt("RATE_LIMIT_AUTH_MAX", 30),
    windowSec,
  };
}

export interface DbRateLimitConfig {
  enabled: boolean;
  max: number;
  windowSec: number;
  maxConcurrent: number;
  maxQueue: number;
}

export function getDbRateLimitConfig(): DbRateLimitConfig {
  return {
    enabled: envFlag("DB_RATE_LIMIT_ENABLED", true),
    max: envInt("DB_RATE_LIMIT_MAX", 600),
    windowSec: envInt("DB_RATE_LIMIT_WINDOW_SEC", 60),
    maxConcurrent: envInt("DB_MAX_CONCURRENT_QUERIES", 20),
    maxQueue: envInt("DB_MAX_QUEUED_QUERIES", 40),
  };
}
