/**
 * Bloom filter — probabilistic set membership for "definitely not present" checks.
 *
 * Problem: a lookup for a key that does not exist still costs a full database
 * round trip (index probe + network + row decode). Under a scan/404 storm that
 * is the most expensive kind of traffic, because it can never be cached
 * positively.
 *
 * Solution: keep a compact probabilistic set of the keys that DO exist. A
 * Bloom filter answers "maybe present" (true) or "definitely absent" (false).
 * A false positive is harmless — the caller falls through to the database and
 * gets the truth. A false negative would be a correctness bug, so this module
 * is deliberately conservative: it never removes keys, and the guard that uses
 * it (`db-guard.ts`) only trusts a "definitely absent" answer when it can prove
 * no row was inserted after the filter was built.
 *
 * Shape: `m` bits in a bitset, `k` hash functions. The optimal size for
 * `n` expected items at a target false-positive rate `p` is
 *
 *   m = -n * ln(p) / (ln 2)^2      k = round(m/n * ln 2)
 *
 * The filter grows (doubling `m`) when more items are added than it was sized
 * for, so an under-sized filter degrades in accuracy instead of breaking.
 *
 * Hashing: FNV-1a (32 bit) plus an independently seeded second pass, combined
 * with the Kirsch–Mitzenmacher trick (`g_i = h1 + i*h2`) — `k` probes from two
 * hashes instead of `k` independent hashes.
 *
 * No dependencies, no I/O: pure data + maths, so it is safe on both the server
 * and the client, and trivially unit-testable.
 */

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a. `seed` lets us derive a second, independent hash. */
export function fnv1a(input: string, seed = FNV_OFFSET_BASIS): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  // Final avalanche so short/low-entropy keys still spread over the bitset.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Options / stats
// ---------------------------------------------------------------------------

export interface BloomFilterOptions {
  /** Expected number of items (n). Default 1024. */
  expectedItems?: number;
  /** Target false-positive rate (p). Default 0.01 (1%). */
  falsePositiveRate?: number;
  /** Explicit bit count (m) — overrides the derived size. */
  bits?: number;
  /** Explicit hash count (k) — overrides the derived count. */
  hashes?: number;
}

export interface BloomFilterStats {
  /** Bits in the bitset (m). */
  bitCount: number;
  /** Hash functions used (k). */
  hashCount: number;
  /** Items added so far (n). */
  inserted: number;
  /** Fraction of bits set (0..1). */
  fillRatio: number;
  /** Estimated probability of a false positive at the current fill. */
  falsePositiveRate: number;
  /** Bytes the bitset occupies. */
  bytes: number;
  /** True once the filter holds more items than it was sized for. */
  saturated: boolean;
}

export interface SerializedBloomFilter {
  /** Base64 of the raw bitset. */
  bits: string;
  bitCount: number;
  hashCount: number;
  inserted: number;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

const DEFAULT_EXPECTED_ITEMS = 1024;
const DEFAULT_FALSE_POSITIVE_RATE = 0.01;
/** Grow once the filter holds this multiple of its intended item count. */
const GROWTH_FACTOR = 2;

export class BloomFilter {
  private bits: Uint8Array;
  private bitCount: number;
  private hashCount: number;
  private inserted = 0;
  private readonly maxItems: number;
  /**
   * Set when more items were added than the filter was sized for. A saturated
   * filter can no longer answer "definitely absent" with confidence, so it
   * degrades to "maybe present" (see {@link has}) — the caller falls through to
   * the database, which is always correct.
   */
  private saturated = false;

  constructor(options: BloomFilterOptions = {}) {
    const expected = Math.max(1, Math.floor(options.expectedItems ?? DEFAULT_EXPECTED_ITEMS));
    const p = clampRate(options.falsePositiveRate ?? DEFAULT_FALSE_POSITIVE_RATE);
    const derivedBits = Math.max(64, Math.ceil((-expected * Math.log(p)) / Math.LN2 ** 2));
    const derivedHashes = Math.max(1, Math.round((derivedBits / expected) * Math.LN2));

    this.bitCount = Math.max(64, Math.floor(options.bits ?? derivedBits));
    this.hashCount = Math.max(1, Math.floor(options.hashes ?? derivedHashes));
    this.maxItems = expected * GROWTH_FACTOR;
    this.bits = new Uint8Array(Math.ceil(this.bitCount / 8));
  }

  /** Number of items added so far. */
  get size(): number {
    return this.inserted;
  }

  /** Bits in the bitset (m). */
  get bitsCount(): number {
    return this.bitCount;
  }

  /** Hash functions used (k). */
  get hashesCount(): number {
    return this.hashCount;
  }

  /**
   * Add a key.
   *
   * Returns `true` when the key was already considered present (all probe bits
   * were set) — i.e. the call was a no-op.
   */
  add(key: string): boolean {
    const { h1, h2 } = this.hashes(key);
    let alreadyPresent = true;
    for (let i = 0; i < this.hashCount; i++) {
      const index = this.probe(h1, h2, i);
      const byte = index >>> 3;
      const mask = 1 << (index & 7);
      if ((this.bits[byte]! & mask) === 0) {
        this.bits[byte]! |= mask;
        alreadyPresent = false;
      }
    }
    if (!alreadyPresent) this.inserted++;
    if (this.inserted > this.maxItems) this.saturated = true;
    return alreadyPresent;
  }

  /**
   * Membership test.
   *
   * `true`  → "maybe present" (the key might exist — go to the database).
   * `false` → "definitely absent" (no key ever added can produce this).
   */
  has(key: string): boolean {
    if (this.saturated) return true;
    const { h1, h2 } = this.hashes(key);
    for (let i = 0; i < this.hashCount; i++) {
      const index = this.probe(h1, h2, i);
      const byte = index >>> 3;
      const mask = 1 << (index & 7);
      if ((this.bits[byte]! & mask) === 0) return false;
    }
    return true;
  }

  /** True once the filter holds more items than it was sized for. */
  get isSaturated(): boolean {
    return this.saturated;
  }

  /** Remove every key. */
  clear(): void {
    this.bits.fill(0);
    this.inserted = 0;
  }

  stats(): BloomFilterStats {
    let set = 0;
    for (let i = 0; i < this.bits.length; i++) {
      let byte = this.bits[i]!;
      while (byte) {
        set += byte & 1;
        byte >>= 1;
      }
    }
    const fillRatio = set / this.bitCount;
    const exponent = -this.hashCount * fillRatio;
    return {
      bitCount: this.bitCount,
      hashCount: this.hashCount,
      inserted: this.inserted,
      fillRatio,
      falsePositiveRate: Math.pow(1 - Math.exp(exponent), this.hashCount),
      bytes: this.bits.length,
      saturated: this.saturated,
    };
  }

  /** Serialize for a shared cache (base64 bitset + metadata). */
  serialize(): SerializedBloomFilter {
    return {
      bits: bytesToBase64(this.bits),
      bitCount: this.bitCount,
      hashCount: this.hashCount,
      inserted: this.inserted,
    };
  }

  /** Rebuild from {@link serialize}. */
  static deserialize(payload: SerializedBloomFilter, options: BloomFilterOptions = {}): BloomFilter {
    const filter = new BloomFilter({
      ...options,
      bits: payload.bitCount,
      hashes: payload.hashCount,
      expectedItems: options.expectedItems ?? Math.max(1, payload.inserted),
    });
    const bytes = base64ToBytes(payload.bits);
    filter.bits = bytes.length >= Math.ceil(payload.bitCount / 8) ? bytes : new Uint8Array(bytes);
    filter.inserted = payload.inserted;
    return filter;
  }

  private hashes(key: string): { h1: number; h2: number } {
    const h1 = fnv1a(key);
    // Odd multiplier -> coprime with the modulus, so the probes never cycle
    // through a short cycle before covering `hashCount` distinct positions.
    const h2 = (fnv1a(key, 0x9e3779b9) | 1) >>> 0;
    return { h1, h2 };
  }

  private probe(h1: number, h2: number, i: number): number {
    // `Math.imul` returns a *signed* 32 bit value — the unsigned shift keeps
    // the probe index inside the bitset (a negative index would silently
    // address `undefined` and lose the bit).
    return ((h1 + Math.imul(i, h2)) >>> 0) % this.bitCount;
  }
}

// ---------------------------------------------------------------------------
// Registry — one named filter per table (or per logical set)
// ---------------------------------------------------------------------------

export interface BloomIndexEntry {
  name: string;
  filter: BloomFilter;
  /** Epoch ms when the filter was built — used for staleness proofs. */
  builtAt: number;
}

export class BloomFilterRegistry {
  private entries = new Map<string, BloomIndexEntry>();

  get(name: string): BloomIndexEntry | undefined {
    return this.entries.get(name);
  }

  set(name: string, filter: BloomFilter, builtAt = Date.now()): BloomIndexEntry {
    const entry: BloomIndexEntry = { name, filter, builtAt };
    this.entries.set(name, entry);
    return entry;
  }

  /** Get the filter for `name`, creating an empty one when missing. */
  ensure(name: string, options: BloomFilterOptions = {}): BloomIndexEntry {
    const existing = this.entries.get(name);
    if (existing) return existing;
    return this.set(name, new BloomFilter(options));
  }

  /** Drop a filter — the next use rebuilds it from the source of truth. */
  invalidate(name: string): boolean {
    return this.entries.delete(name);
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): Record<string, BloomFilterStats & { builtAt: number }> {
    const out: Record<string, BloomFilterStats & { builtAt: number }> = {};
    for (const [name, entry] of this.entries) {
      out[name] = { ...entry.filter.stats(), builtAt: entry.builtAt };
    }
    return out;
  }
}

/** Process-wide registry (survives dev HMR via globalThis). */
const globalRef = globalThis as typeof globalThis & {
  __bloomRegistry__?: BloomFilterRegistry;
};

export function getBloomRegistry(): BloomFilterRegistry {
  globalRef.__bloomRegistry__ ??= new BloomFilterRegistry();
  return globalRef.__bloomRegistry__;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_FALSE_POSITIVE_RATE;
  if (rate >= 1) return 0.99;
  return rate;
}

/** Base64 of a byte array — works in Node and the browser (no Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Inverse of {@link bytesToBase64}. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
