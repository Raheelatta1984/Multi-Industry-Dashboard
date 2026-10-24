/**
 * Negative cache — remember the answers that are *empty*.
 *
 * Problem: a lookup for something that does not exist (a board id that was
 * never created, a file that was deleted, a row that was never inserted) still
 * costs a full database round trip, and unlike a positive result it can never
 * be cached as a value — so those queries hit the database on every single
 * request. A single client looping over guessed ids can keep a database at 100%
 * CPU while returning nothing.
 *
 * Solution: cache the *absence*. When a read comes back empty we store a short
 * lived marker for that exact query; the next identical query is answered from
 * the marker without touching the database at all.
 *
 * The TTL is deliberately short (30s by default) compared with the positive
 * cache (60s): a missing row that appears later must show up quickly, while a
 * burst of identical misses still collapses into a single query.
 *
 * Storage: a bounded in-memory TTL map (always available) mirrored into the
 * shared cache when one is configured, so a fleet of instances shares the
 * markers instead of each hitting the database once.
 *
 * Invalidation: writes clear the markers for the affected table
 * (see `db-guard.ts`), so a freshly inserted row is visible immediately.
 */

import { getCacheConfig, getMemcachedClient } from "./memcached.ts";

/** Marker stored for a known-missing key. A string so it survives JSON. */
const NEGATIVE_MARKER = "1";

export interface NegativeCacheOptions {
  /** Marker lifetime in seconds. Default 30. */
  ttlSec?: number;
  /** Maximum markers kept in the local map. Default 5000. */
  maxKeys?: number;
  /** Mirror markers into the shared cache. Default true. */
  shared?: boolean;
}

export interface NegativeCacheStats {
  /** Lookups answered from a marker. */
  hits: number;
  /** Lookups with no marker. */
  misses: number;
  /** Markers written. */
  marks: number;
  /** Markers removed (write invalidation / expiry). */
  evictions: number;
  /** Markers currently held locally. */
  size: number;
}

/** A bounded TTL map — the local half of the negative cache. */
export class MemoryTtlStore {
  private map = new Map<string, { value: string; expiresAt: number }>();
  private readonly maxKeys: number;

  constructor(maxKeys = 5000) {
    this.maxKeys = maxKeys;
  }

  get(key: string): string | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    // Refresh recency for the LRU eviction order.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, ttlSec: number): void {
    if (this.map.size >= this.maxKeys) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /** Delete every key starting with `prefix` — used for table-scoped busting. */
  deletePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export class NegativeCache {
  private readonly local: MemoryTtlStore;
  private readonly ttlSec: number;
  private readonly shared: boolean;
  private hits = 0;
  private misses = 0;
  private marks = 0;
  private evictions = 0;

  constructor(options: NegativeCacheOptions = {}) {
    this.ttlSec = options.ttlSec ?? 30;
    this.local = new MemoryTtlStore(options.maxKeys ?? 5000);
    this.shared = options.shared ?? true;
  }

  /** Namespaced key — the namespace is usually the table or route. */
  key(namespace: string, key: string): string {
    return `neg:${namespace}:${key}`;
  }

  /**
   * Is this key known to be missing?
   *
   * `true`  → the answer is "nothing here" — skip the database.
   * `false` → unknown, ask the database.
   */
  async has(namespace: string, key: string): Promise<boolean> {
    const full = this.key(namespace, key);
    if (this.local.get(full) !== null) {
      this.hits++;
      return true;
    }
    if (this.shared && getCacheConfig().enabled) {
      try {
        const cached = await getMemcachedClient().get<string>(full);
        if (cached === NEGATIVE_MARKER) {
          // Promote to the local store so the next lookup is free.
          this.local.set(full, NEGATIVE_MARKER, this.ttlSec);
          this.hits++;
          return true;
        }
      } catch {
        // A cache outage must never fail the request — fall through.
      }
    }
    this.misses++;
    return false;
  }

  /** Record that `key` does not exist. */
  async mark(namespace: string, key: string, ttlSec = this.ttlSec): Promise<void> {
    const full = this.key(namespace, key);
    this.local.set(full, NEGATIVE_MARKER, ttlSec);
    this.marks++;
    if (this.shared && getCacheConfig().enabled) {
      try {
        await getMemcachedClient().set(full, NEGATIVE_MARKER, ttlSec);
      } catch {
        // Ignore — the local marker already does the job.
      }
    }
  }

  /** Forget one marker (e.g. the row was just created). */
  async remove(namespace: string, key: string): Promise<void> {
    const full = this.key(namespace, key);
    if (this.local.delete(full)) this.evictions++;
    if (this.shared && getCacheConfig().enabled) {
      try {
        await getMemcachedClient().delete(full);
      } catch {
        // Ignore.
      }
    }
  }

  /** Forget every marker of a namespace (e.g. after a write to that table). */
  async removeNamespace(namespace: string): Promise<number> {
    const prefix = `neg:${namespace}:`;
    const count = this.local.deletePrefix(prefix);
    this.evictions += count;
    if (this.shared && getCacheConfig().enabled) {
      try {
        await getMemcachedClient().invalidatePattern(`${prefix}*`);
      } catch {
        // Ignore.
      }
    }
    return count;
  }

  /** Forget everything. */
  async clear(): Promise<void> {
    this.local.clear();
    if (this.shared && getCacheConfig().enabled) {
      try {
        await getMemcachedClient().invalidatePattern("neg:*");
      } catch {
        // Ignore.
      }
    }
  }

  stats(): NegativeCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      marks: this.marks,
      evictions: this.evictions,
      size: this.local.size,
    };
  }
}

/** Process-wide negative cache (survives dev HMR via globalThis). */
const globalRef = globalThis as typeof globalThis & {
  __negativeCache__?: NegativeCache;
};

export function getNegativeCache(): NegativeCache {
  globalRef.__negativeCache__ ??= new NegativeCache({
    ttlSec: envInt("NEGATIVE_CACHE_TTL_SEC", 30),
    maxKeys: envInt("NEGATIVE_CACHE_MAX_KEYS", 5000),
  });
  return globalRef.__negativeCache__;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}
