/**
 * Distributed 64-bit ID generator (Snowflake-style) to avoid ID clashes
 *
 * Pattern: 64 bits = 41 bits timestamp + 13 bits shard reference + 10 bits counter
 *
 *   0 - 0000000000000000000000000000000000000000000 - 0000000000000 - 0000000000
 *   |   |                                         |   |             |   |
 *   |   41 bits: timestamp (ms since epoch)       |   13 bits: shard|   10 bits: sequence
 *   |                                             |   (8192 shards) |   (1024 per ms per shard)
 *   sign (unused, always 0 for positive)
 *
 * Benefits:
 *   - Sortable by time (k-sortable): IDs roughly ordered by creation time
 *   - No coordination needed between shards (each shard has its own counter)
 *   - 13 bits shard = 8192 logical shards (matches image sharding)
 *   - 10 bits counter = 1024 IDs per ms per shard = 1M IDs/sec per shard
 *   - 41 bits timestamp = ~69 years from custom epoch
 *
 * Custom epoch: 2024-01-01T00:00:00.000Z (chosen to maximize future range)
 *
 * Usage:
 *   import { nextId, parseId, getShardFromId } from "@/lib/id/next-id"
 *   const id = nextId(42) // shard 42
 *   const id2 = nextId() // auto shard from env or random
 *
 * Env:
 *   ID_SHARD_ID - default shard ID for this instance (0..8191)
 *   ID_EPOCH - custom epoch ms (default 2024-01-01)
 */

export const CUSTOM_EPOCH_MS = Date.UTC(2024, 0, 1, 0, 0, 0, 0); // 2024-01-01

// Bit lengths
export const TIMESTAMP_BITS = 41;
export const SHARD_BITS = 13;
export const COUNTER_BITS = 10;

// Max values
export const MAX_SHARD_ID = Math.pow(2, SHARD_BITS) - 1; // 8191
export const MAX_COUNTER = Math.pow(2, COUNTER_BITS) - 1; // 1023
export const MAX_TIMESTAMP = Math.pow(2, TIMESTAMP_BITS) - 1; // 2^41-1 ms ~ 69 years
export const MAX_TIMESTAMP_BIG = (1n << BigInt(TIMESTAMP_BITS)) - 1n;

// Shifts
export const COUNTER_SHIFT = 0;
export const SHARD_SHIFT = COUNTER_BITS; // 10
export const TIMESTAMP_SHIFT = SHARD_BITS + COUNTER_BITS; // 23

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

// ---------------------------------------------------------------------------
// State per shard - in-memory counter
// ---------------------------------------------------------------------------

type ShardState = {
  lastTimestamp: number;
  counter: number;
};

const shardStates = new Map<number, ShardState>();

// Global lock for simplicity (JS is single-threaded, but async could interleave)
let lastGlobalTimestamp = 0;

function getDefaultShardId(): number {
  const envShard = envInt("ID_SHARD_ID", -1);
  if (envShard >= 0 && envShard <= MAX_SHARD_ID) return envShard;

  // Try to derive from IMAGE shard or machine, or random
  const machineId = env("HOSTNAME") ?? env("MACHINE_ID") ?? "";
  if (machineId) {
    // Hash hostname to shard
    let hash = 0;
    for (let i = 0; i < machineId.length; i++) {
      hash = (hash << 5) - hash + machineId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % (MAX_SHARD_ID + 1);
  }

  // Random shard (not ideal for production, but works for dev)
  return Math.floor(Math.random() * (MAX_SHARD_ID + 1));
}

function waitUntilNextMs(lastTs: number): number {
  let ts = Date.now();
  while (ts <= lastTs) {
    // Busy wait for next ms - in JS we can use Atomics.wait or simple loop
    // For performance, we use a tiny spin with Date.now()
    ts = Date.now();
  }
  return ts;
}

/**
 * Generate next 64-bit ID
 * @param shardId - 0..8191, optional (uses env or random if not provided)
 * @returns bigint ID (as bigint) and string representation
 */
export function nextIdBigInt(shardId?: number): bigint {
  const shard = shardId != null ? shardId : getDefaultShardId();

  if (shard < 0 || shard > MAX_SHARD_ID) {
    throw new Error(`shardId must be 0..${MAX_SHARD_ID}, got ${shard}`);
  }

  let state = shardStates.get(shard);
  if (!state) {
    state = { lastTimestamp: 0, counter: 0 };
    shardStates.set(shard, state);
  }

  let now = Date.now();
  const epochNow = now - CUSTOM_EPOCH_MS;

  if (epochNow < 0) {
    throw new Error(`Clock before custom epoch: ${new Date(now).toISOString()}`);
  }
  if (epochNow > MAX_TIMESTAMP) {
    throw new Error(`Timestamp overflow: ${epochNow} > max ${MAX_TIMESTAMP}`);
  }

  // Handle same ms: increment counter
  if (now === state.lastTimestamp) {
    state.counter = (state.counter + 1) & MAX_COUNTER;
    if (state.counter === 0) {
      // Counter overflow in same ms, wait for next ms
      now = waitUntilNextMs(state.lastTimestamp);
      state.lastTimestamp = now;
    }
  } else {
    state.counter = 0;
    state.lastTimestamp = now;
  }

  // Global monotonicity guard (optional, ensures time moves forward)
  if (now < lastGlobalTimestamp) {
    now = waitUntilNextMs(lastGlobalTimestamp);
    state.lastTimestamp = now;
    state.counter = 0;
  }
  lastGlobalTimestamp = now;

  const timestampPart = BigInt(epochNow) << BigInt(TIMESTAMP_SHIFT);
  const shardPart = BigInt(shard) << BigInt(SHARD_SHIFT);
  const counterPart = BigInt(state.counter);

  const id = timestampPart | shardPart | counterPart;
  return id;
}

/**
 * Generate next ID as string (safe for JSON, Postgres bigint, etc.)
 */
export function nextId(shardId?: number): string {
  return nextIdBigInt(shardId).toString();
}

/**
 * Generate next ID as number (only safe if < 2^53, which our IDs are not after ~few years)
 * Prefer string or bigint. This is for compatibility only and may lose precision.
 */
export function nextIdNumber(shardId?: number): number {
  const big = nextIdBigInt(shardId);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
    console.warn("[next-id] ID exceeds MAX_SAFE_INTEGER, precision loss may occur");
  }
  return Number(big);
}

export interface ParsedId {
  id: bigint;
  idStr: string;
  timestampMs: number; // absolute ms
  timestamp: Date;
  shardId: number;
  counter: number;
  epochMs: number; // ms since custom epoch
}

/**
 * Parse a 64-bit ID back into its components
 */
export function parseId(id: string | bigint | number): ParsedId {
  let big: bigint;
  if (typeof id === "bigint") big = id;
  else if (typeof id === "number") big = BigInt(id);
  else big = BigInt(id);

  const counter = Number(big & BigInt(MAX_COUNTER));
  const shardId = Number((big >> BigInt(SHARD_SHIFT)) & BigInt(MAX_SHARD_ID));
  const epochMs = Number(big >> BigInt(TIMESTAMP_SHIFT));
  const timestampMs = epochMs + CUSTOM_EPOCH_MS;

  return {
    id: big,
    idStr: big.toString(),
    timestampMs,
    timestamp: new Date(timestampMs),
    shardId,
    counter,
    epochMs,
  };
}

export function getShardFromId(id: string | bigint | number): number {
  return parseId(id).shardId;
}

export function getTimestampFromId(id: string | bigint | number): Date {
  return parseId(id).timestamp;
}

/**
 * Sort IDs chronologically (they are k-sorted, but this ensures exact sort)
 */
export function sortIds(ids: (string | bigint)[]): (string | bigint)[] {
  return [...ids].sort((a, b) => {
    const ba = typeof a === "bigint" ? a : BigInt(a);
    const bb = typeof b === "bigint" ? b : BigInt(b);
    return ba < bb ? -1 : ba > bb ? 1 : 0;
  });
}

/**
 * Generate multiple IDs in batch (more efficient, guarantees order)
 */
export function nextIds(count: number, shardId?: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(nextId(shardId));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Utilities for integration with storage/sharding
// ---------------------------------------------------------------------------

/**
 * Get shard ID that aligns with image logical shard
 * Maps 0..1023 image shards to 0..8191 ID shards (multiply by 8)
 */
export function imageShardToIdShard(imageLogicalShard: number): number {
  // 1024 image shards * 8 = 8192 ID shards
  return (imageLogicalShard * 8) % (MAX_SHARD_ID + 1);
}

/**
 * Get ID shard for current machine (based on IMAGE_PHYSICAL_MACHINES or HOSTNAME)
 */
export function getMachineShardId(): number {
  return getDefaultShardId();
}

/**
 * Reset internal state (for testing only)
 */
export function _resetForTest(): void {
  shardStates.clear();
  lastGlobalTimestamp = 0;
}

/**
 * Stats for monitoring
 */
export function getIdGeneratorStats(): {
  shardsTracked: number;
  lastGlobalTimestamp: number;
  customEpoch: string;
  bits: { timestamp: number; shard: number; counter: number };
  maxValues: { shard: number; counter: number; timestamp: number };
} {
  return {
    shardsTracked: shardStates.size,
    lastGlobalTimestamp,
    customEpoch: new Date(CUSTOM_EPOCH_MS).toISOString(),
    bits: {
      timestamp: TIMESTAMP_BITS,
      shard: SHARD_BITS,
      counter: COUNTER_BITS,
    },
    maxValues: {
      shard: MAX_SHARD_ID,
      counter: MAX_COUNTER,
      timestamp: MAX_TIMESTAMP,
    },
  };
}
